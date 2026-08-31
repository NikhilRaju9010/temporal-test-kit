import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkF1FailingChildHandled } from "./f1.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "ParentWorkflow", taskQueue: "parent", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkF1FailingChildHandled — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].hasChildWorkflows when unset", async () => {
    const result = await checkF1FailingChildHandled(FAKE_ENV, baseTarget, { childWorkflows: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("F1");
    expect(result.hint).toContain("workflows[].hasChildWorkflows");
  });

  it("skips when hasChildWorkflows is explicitly false", async () => {
    const result = await checkF1FailingChildHandled(FAKE_ENV, { ...baseTarget, hasChildWorkflows: false }, { childWorkflows: true });
    expect(result.status).toBe("SKIPPED");
  });
});

describe("checkF1FailingChildHandled (real @temporalio/testing + sample project's ParentWorkflow/ChildWorkflow)", () => {
  it("discovers the child's activity, forces it to fail, and confirms the parent reaches a clean FAILED state — not silently COMPLETED, not stuck", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkF1FailingChildHandled(
        env,
        {
          type: "ParentWorkflow",
          taskQueue: "ttk-f1-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
          sampleInput: { childTaskId: "TEST-F1-001", parentClosePolicy: "TERMINATE" },
        },
        { childWorkflows: true },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("F1");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/FAILED/);
    expect(result.message).toMatch(/childTaskActivity/);
  }, 60_000);

  it("reports FAIL when the child never actually schedules an activity (e.g. missing sampleInput causes an earlier, unrelated failure)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkF1FailingChildHandled(
        env,
        {
          type: "ParentWorkflow",
          taskQueue: "ttk-f1-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
          // No sampleInput — ParentWorkflow destructures `input.childTaskId`,
          // so it never gets far enough to start a child that schedules
          // anything.
        },
        { childWorkflows: true },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/never.*(scheduled|invoked|ran)/i);
  }, 30_000);
});
