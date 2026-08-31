import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkH3CancelParentHandlesChildren } from "./h3.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "ParentWorkflow", taskQueue: "parent", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkH3CancelParentHandlesChildren — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].hasChildWorkflows when unset", async () => {
    const result = await checkH3CancelParentHandlesChildren(FAKE_ENV, baseTarget, { childWorkflows: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("H3");
    expect(result.hint).toContain("workflows[].hasChildWorkflows");
  });
});

describe("checkH3CancelParentHandlesChildren (real @temporalio/testing + sample project's ParentWorkflow/ChildWorkflow)", () => {
  it("cancels the parent mid-flight and confirms the cancellation propagates to a real, in-flight child", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkH3CancelParentHandlesChildren(
        env,
        {
          type: "ParentWorkflow",
          taskQueue: "ttk-h3-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
          sampleInput: { childTaskId: "TEST-H3-001", parentClosePolicy: "TERMINATE" },
        },
        { childWorkflows: true },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("H3");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/CANCELED/);
    expect(result.message).toMatch(/WorkflowExecutionCancelRequested/);
  }, 60_000);

  it("reports FAIL when the child never actually starts (e.g. missing sampleInput causes an earlier, unrelated failure)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkH3CancelParentHandlesChildren(
        env,
        {
          type: "ParentWorkflow",
          taskQueue: "ttk-h3-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
          // No sampleInput — ParentWorkflow destructures `input.childTaskId`,
          // so it never gets far enough to start a child at all.
        },
        { childWorkflows: true },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/never actually started a child workflow/);
  }, 30_000);
});
