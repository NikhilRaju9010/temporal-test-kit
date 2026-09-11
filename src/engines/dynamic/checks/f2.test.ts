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

  it("honors a waitBudgetsMs.F2.childStartTimeoutMs override instead of the hardcoded default", async () => {
    // No sampleInput means ParentWorkflow never gets far enough to start a
    // child at all, so this deterministically hits the "never actually
    // started a child workflow within Nms" FAIL branch — proving the
    // override (not the 6000ms default) bounded the wait.
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkF2ChildNotOrphaned(
        env,
        {
          type: "ParentWorkflow",
          taskQueue: "ttk-f2-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
        },
        { childWorkflows: true },
        undefined,
        { F2: { childStartTimeoutMs: 50 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/50ms/);
  }, 30_000);
});

const PRIMING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "priming-gated-workflows.ts");
const loadPrimingActivities = () => import(join(import.meta.dirname, "fixtures", "priming-activities.ts"));

describe("checkF2ChildNotOrphaned — workflows[].primingSignals", () => {
  it("reaches a startChild() gated behind an unbounded signal wait when primingSignals is configured", async () => {
    const activities = await loadPrimingActivities();
    const result = await withEphemeralEnvironment((env) =>
      checkF2ChildNotOrphaned(
        env,
        {
          type: "GatedParentWorkflow",
          taskQueue: "ttk-f2-priming",
          workflowsPath: PRIMING_WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
          primingSignals: [{ name: "unlockSignal", payload: undefined }],
        },
        {},
      ),
    );
    expect(result.message).not.toContain("never actually started a child workflow");
  }, 90_000);

  it("DEFAULT (no primingSignals): sends nothing, so the parent never reaches startChild() and the check reports exactly what it always did", async () => {
    const activities = await loadPrimingActivities();
    const result = await withEphemeralEnvironment((env) =>
      checkF2ChildNotOrphaned(
        env,
        {
          type: "GatedParentWorkflow",
          taskQueue: "ttk-f2-priming-default",
          workflowsPath: PRIMING_WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
        },
        {},
      ),
    );
    expect(result.status).toBe("FAIL");
    expect(result.message).toContain("never actually started a child workflow");
  }, 90_000);
});
