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
});
