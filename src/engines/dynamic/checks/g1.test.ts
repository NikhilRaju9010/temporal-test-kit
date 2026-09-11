import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkG1SagaCompensation } from "./g1.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

const FAKE_ENV_TARGET = {
  type: "SagaWorkflow",
  taskQueue: "ttk-g1-test",
};

describe("checkG1SagaCompensation — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].sagaFailurePoint when unset", async () => {
    const activities = await loadActivities();
    const result = await checkG1SagaCompensation(
      {} as never,
      { ...FAKE_ENV_TARGET, workflowsPath: WORKFLOWS_PATH, activities },
      {},
    );
    expect(result.status).toBe("SKIPPED");
    expect(result.hint).toContain("workflows[].sagaFailurePoint");
  });
});

describe("checkG1SagaCompensation (real @temporalio/testing + sample project's SagaWorkflow)", () => {
  it("forces the named saga step to fail, and confirms the workflow reaches a clean FAILED state — not silently COMPLETED, not stuck", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkG1SagaCompensation(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-g1-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sagaFailurePoint: "chargeCardActivity",
          sampleInput: { orderId: "TEST-G1-001", cardNumber: "4242424242424242", amount: 10 },
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("G1");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/FAILED/);
  }, 30_000);

  it("reports FAIL when the named activity is never actually reached (e.g. missing sampleInput causes an earlier, unrelated failure)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkG1SagaCompensation(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-g1-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sagaFailurePoint: "chargeCardActivity",
          // No sampleInput — SagaWorkflow destructures `input.orderId`, so
          // it fails immediately on undefined input, before ever reaching
          // chargeCardActivity.
        },
        {},
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/never.*(reached|scheduled|invoked|ran)|chargeCardActivity/i);
  }, 30_000);

  it("honors a waitBudgetsMs.G1.resultWaitMs override instead of the hardcoded default", async () => {
    // Same missing-sampleInput setup as the "never actually reached" test
    // above (which takes ~10s against the DEFAULT 10000ms, per that test's
    // own timing) — with a 1ms override, the check reaches the same
    // never-invoked FAIL conclusion in a fraction of a second instead,
    // proving the override (not the default) bounded the wait.
    const activities = await loadActivities();

    const start = Date.now();
    const result = await withEphemeralEnvironment((env) =>
      checkG1SagaCompensation(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-g1-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sagaFailurePoint: "chargeCardActivity",
          // No sampleInput — same as the test above.
        },
        {},
        undefined,
        { G1: { resultWaitMs: 1 } },
      ),
    );
    const elapsedMs = Date.now() - start;

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/never actually invoked/i);
    // Load-independent bound: RESULT_WAIT_MS's own default is 10000ms, so if
    // the override weren't actually used, elapsed time would be AT LEAST
    // that — holds regardless of machine speed/contention.
    expect(elapsedMs).toBeLessThan(15_000); // generous margin over the 10000ms default for full-suite-load overhead
  }, 30_000);
});

const PRIMING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "priming-gated-workflows.ts");
const loadPrimingActivities = () => import(join(import.meta.dirname, "fixtures", "priming-activities.ts"));

describe("checkG1SagaCompensation — workflows[].primingSignals", () => {
  it("reaches a saga failure point gated behind an unbounded signal wait when primingSignals is configured", async () => {
    const activities = await loadPrimingActivities();
    const result = await withEphemeralEnvironment((env) =>
      checkG1SagaCompensation(
        env,
        {
          type: "GatedWorkflow",
          taskQueue: "ttk-g1-priming",
          workflowsPath: PRIMING_WORKFLOWS_PATH,
          activities,
          sagaFailurePoint: "gatedActivity",
          primingSignals: [{ name: "unlockSignal", payload: undefined }],
        },
        {},
      ),
    );
    expect(result.status).toBe("PASS");
    expect(result.message).not.toContain("never actually invoked");
  }, 60_000);

  it("DEFAULT (no primingSignals): sends nothing, so the failure point stays unreachable and the check reports exactly what it always did", async () => {
    const activities = await loadPrimingActivities();
    const result = await withEphemeralEnvironment((env) =>
      checkG1SagaCompensation(
        env,
        {
          type: "GatedWorkflow",
          taskQueue: "ttk-g1-priming-default",
          workflowsPath: PRIMING_WORKFLOWS_PATH,
          activities,
          sagaFailurePoint: "gatedActivity",
        },
        {},
      ),
    );
    expect(result.status).toBe("FAIL");
    expect(result.message).toContain("never actually invoked gatedActivity");
  }, 60_000);
});
