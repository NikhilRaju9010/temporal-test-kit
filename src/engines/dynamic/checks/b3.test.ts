import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkB3Idempotency } from "./b3.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkB3Idempotency — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].idempotencyTestActivity when unset", async () => {
    const result = await checkB3Idempotency(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("B3");
    expect(result.hint).toContain("workflows[].idempotencyTestActivity");
  });
});

describe("checkB3Idempotency (real @temporalio/testing + sample project's SagaWorkflow/chargeCardActivity)", () => {
  it("forces the named activity to be reattempted after appearing to succeed, and confirms the workflow still completes — while being explicit that this is NOT proof the activity's real side effect was deduplicated", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkB3Idempotency(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-b3-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          idempotencyTestActivity: "chargeCardActivity",
          sampleInput: { orderId: "TEST-B3-001", cardNumber: "4242424242424242", amount: 10 },
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("B3");
    expect(result.hint).toBeNull();
    // Honesty requirement, same treatment L1 got: the message must not
    // claim more than what was actually verified.
    expect(result.message).toMatch(/reattempt|retried|attempt 2/i);
    expect(result.message).toMatch(/not.*(confirm|prove|verify).*(dedup|duplicat|real.?world|side effect)/i);
  }, 30_000);

  it("reports FAIL when the named activity is never actually reached (e.g. missing sampleInput causes an earlier, unrelated failure)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkB3Idempotency(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-b3-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          idempotencyTestActivity: "chargeCardActivity",
          // No sampleInput — same missing-input edge case G1 handles.
        },
        {},
      ),
    );

    expect(result.status).toBe("FAIL");
  }, 30_000);

  it("honors a waitBudgetsMs.B3.resultWaitMs override instead of the hardcoded default", async () => {
    // Same reasoning as G1/L2: the real forced-retry sequence needs real
    // time to reach a terminal state, so a 1ms wait reliably produces SOME
    // FAIL well under the 10000ms default, proving the override bounded
    // this run via elapsed time.
    const activities = await loadActivities();

    const start = Date.now();
    const result = await withEphemeralEnvironment((env) =>
      checkB3Idempotency(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-b3-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          idempotencyTestActivity: "chargeCardActivity",
          sampleInput: { orderId: "TEST-B3-002", cardNumber: "4242424242424242", amount: 10 },
        },
        {},
        undefined,
        { B3: { resultWaitMs: 1 } },
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

async function loadPrimingActivities() {
  return import(join(import.meta.dirname, "fixtures", "priming-activities.ts"));
}

describe("checkB3Idempotency — workflows[].primingSignals", () => {
  it("reaches an activity gated behind an unbounded signal wait when primingSignals is configured", async () => {
    const activities = await loadPrimingActivities();
    const result = await withEphemeralEnvironment((env) =>
      checkB3Idempotency(
        env,
        {
          type: "GatedWorkflow",
          taskQueue: "ttk-b3-priming",
          workflowsPath: PRIMING_WORKFLOWS_PATH,
          activities,
          idempotencyTestActivity: "gatedActivity",
          primingSignals: [{ name: "unlockSignal", payload: undefined }],
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.message).not.toContain("never actually invoked");
  }, 60_000);

  it("DEFAULT (no primingSignals): sends nothing, so the gated activity stays unreachable and the check reports exactly what it always did", async () => {
    const activities = await loadPrimingActivities();
    const result = await withEphemeralEnvironment((env) =>
      checkB3Idempotency(
        env,
        {
          type: "GatedWorkflow",
          taskQueue: "ttk-b3-priming-default",
          workflowsPath: PRIMING_WORKFLOWS_PATH,
          activities,
          idempotencyTestActivity: "gatedActivity",
        },
        {},
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toContain("never actually invoked gatedActivity");
  }, 60_000);
});
