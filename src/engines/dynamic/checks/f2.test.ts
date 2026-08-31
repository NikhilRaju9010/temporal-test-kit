import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkF2ChildNotOrphaned } from "./f2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "ParentWorkflow", taskQueue: "parent", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkF2ChildNotOrphaned — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].hasChildWorkflows when unset", async () => {
    const result = await checkF2ChildNotOrphaned(FAKE_ENV, baseTarget, { childWorkflows: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("F2");
    expect(result.hint).toContain("workflows[].hasChildWorkflows");
  });
});

describe("checkF2ChildNotOrphaned (real @temporalio/testing + sample project's ParentWorkflow/ChildWorkflow)", () => {
  it("terminates the parent mid-flight and confirms the TERMINATE-policy child does not stay orphaned RUNNING", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkF2ChildNotOrphaned(
        env,
        {
          type: "ParentWorkflow",
          taskQueue: "ttk-f2-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
          sampleInput: { childTaskId: "TEST-F2-001", parentClosePolicy: "TERMINATE" },
        },
        { childWorkflows: true },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("F2");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/TERMINATE/);
  }, 60_000);

  it("reports PASS for an ABANDON policy when the child is correctly left running, not orphaned-as-a-bug", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkF2ChildNotOrphaned(
        env,
        {
          type: "ParentWorkflow",
          taskQueue: "ttk-f2-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
          sampleInput: { childTaskId: "TEST-F2-002", parentClosePolicy: "ABANDON" },
        },
        { childWorkflows: true },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.message).toMatch(/ABANDON/);
    expect(result.message).toMatch(/correct, intended behavior/);
  }, 60_000);
});
