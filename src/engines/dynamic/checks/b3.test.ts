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
});
