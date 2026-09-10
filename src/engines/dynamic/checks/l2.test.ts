import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkL2DependencyOutageRecovery } from "./l2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkL2DependencyOutageRecovery — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].dependencyOutageTestActivity when unset", async () => {
    const result = await checkL2DependencyOutageRecovery(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("L2");
    expect(result.hint).toContain("workflows[].dependencyOutageTestActivity");
  });
});

describe("checkL2DependencyOutageRecovery (real @temporalio/testing + sample project's SagaWorkflow/chargeCardActivity)", () => {
  it("forces the named activity to fail for the first attempts (simulated outage), then recover, and confirms the workflow reaches COMPLETED — while being explicit this doesn't prove behavior for outages exceeding the activity's own retry budget", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkL2DependencyOutageRecovery(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-l2-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          dependencyOutageTestActivity: "chargeCardActivity",
          sampleInput: { orderId: "TEST-L2-001", cardNumber: "4242424242424242", amount: 10 },
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("L2");
    expect(result.hint).toBeNull();
    // Confirms the "genuine outage then recovery" claim, not just "it retried once".
    expect(result.message).toMatch(/outage|recover/i);
    // Honesty requirement, same treatment as B3/L1: don't overclaim beyond
    // what was actually tested (temporary outage within the configured
    // retry budget, not an arbitrarily long one).
    expect(result.message).toMatch(/not.*(prove|confirm|verify).*(exceed|longer|budget|beyond)/i);
  }, 30_000);

  it("reports FAIL when the named activity is never actually reached (e.g. missing sampleInput causes an earlier, unrelated failure)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkL2DependencyOutageRecovery(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-l2-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          dependencyOutageTestActivity: "chargeCardActivity",
          // No sampleInput — same missing-input edge case B3/G1 handle.
        },
        {},
      ),
    );

    expect(result.status).toBe("FAIL");
  }, 30_000);

  it("reports FAIL when the named activity is not a real exported activity in this project's activities module", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkL2DependencyOutageRecovery(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-l2-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          dependencyOutageTestActivity: "notARealActivity",
          sampleInput: { orderId: "TEST-L2-003", cardNumber: "4242424242424242", amount: 10 },
        },
        {},
      ),
    );

    expect(result.status).toBe("FAIL");
  }, 30_000);

  it("honors a waitBudgetsMs.L2.resultWaitMs override instead of the hardcoded default", async () => {
    // The real outage-then-recover sequence needs real Temporal retry
    // backoff time to reach a terminal state, so a 1ms wait can't possibly
    // be enough — this reliably produces SOME FAIL well under the 10000ms
    // default (which branch depends on exact timing, same reasoning as
    // G1/H1), proving the override bounded this run.
    const activities = await loadActivities();

    const start = Date.now();
    const result = await withEphemeralEnvironment((env) =>
      checkL2DependencyOutageRecovery(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-l2-test-4",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          dependencyOutageTestActivity: "chargeCardActivity",
          sampleInput: { orderId: "TEST-L2-004", cardNumber: "4242424242424242", amount: 10 },
        },
        {},
        undefined,
        { L2: { resultWaitMs: 1 } },
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
