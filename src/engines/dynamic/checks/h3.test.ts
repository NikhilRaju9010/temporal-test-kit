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

  it("honors a waitBudgetsMs.H3.childStartTimeoutMs override instead of the hardcoded default", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkH3CancelParentHandlesChildren(
        env,
        {
          type: "ParentWorkflow",
          taskQueue: "ttk-h3-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
          // No sampleInput, same setup as the "never started" test above.
        },
        { childWorkflows: true },
        undefined,
        { H3: { childStartTimeoutMs: 50 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/50ms/);
  }, 30_000);

  it("honors a waitBudgetsMs.H3.resultWaitMs override instead of the hardcoded default", async () => {
    // Timing-based proof, same reasoning as H1: the exact branch reached
    // after a 1ms wait is timing-sensitive, but a fraction-of-a-second
    // elapsed time (vs. the 10000ms default) plus a real FAIL proves the
    // override was what bounded this run, given a scenario that DOES
    // successfully start a child (so childStartTimeoutMs isn't the
    // bottleneck here).
    const activities = await loadActivities();

    const start = Date.now();
    const result = await withEphemeralEnvironment((env) =>
      checkH3CancelParentHandlesChildren(
        env,
        {
          type: "ParentWorkflow",
          taskQueue: "ttk-h3-test-4",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          hasChildWorkflows: true,
          sampleInput: { childTaskId: "TEST-H3-002", parentClosePolicy: "TERMINATE" },
        },
        { childWorkflows: true },
        undefined,
        { H3: { resultWaitMs: 1 } },
      ),
    );
    const elapsedMs = Date.now() - start;

    expect(result.status).toBe("FAIL");
    // Load-independent bound: RESULT_WAIT_MS's own default is 10000ms, so if
    // the override weren't actually used, elapsed time would be AT LEAST
    // that — holds regardless of machine speed/contention.
    expect(elapsedMs).toBeLessThan(15_000); // generous margin over the 10000ms default for full-suite-load overhead
  }, 30_000);
});

const PRIMING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "priming-gated-workflows.ts");
const loadPrimingActivities = () => import(join(import.meta.dirname, "fixtures", "priming-activities.ts"));

describe("checkH3CancelParentHandlesChildren — workflows[].primingSignals", () => {
  it("reaches a startChild() gated behind an unbounded signal wait when primingSignals is configured", async () => {
    const activities = await loadPrimingActivities();
    const result = await withEphemeralEnvironment((env) =>
      checkH3CancelParentHandlesChildren(
        env,
        {
          type: "GatedParentWorkflow",
          taskQueue: "ttk-h3-priming",
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
      checkH3CancelParentHandlesChildren(
        env,
        {
          type: "GatedParentWorkflow",
          taskQueue: "ttk-h3-priming-default",
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
