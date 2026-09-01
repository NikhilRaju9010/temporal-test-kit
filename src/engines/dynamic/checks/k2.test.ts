import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkK2SensitiveDataNotExposed } from "./k2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "SagaWorkflow", taskQueue: "saga", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkK2SensitiveDataNotExposed — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].sensitiveDataFields when unset", async () => {
    const result = await checkK2SensitiveDataNotExposed(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("K2");
    expect(result.hint).toContain("workflows[].sensitiveDataFields");
  });
});

describe("checkK2SensitiveDataNotExposed (real @temporalio/testing + sample project's SagaWorkflow)", () => {
  it("FAILs — sample-project's SagaWorkflow deliberately has no redacting data converter, so cardNumber is recorded in plain text in event history", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkK2SensitiveDataNotExposed(
        env,
        {
          type: "SagaWorkflow",
          taskQueue: "ttk-k2-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: { orderId: "TEST-K2-001", cardNumber: "4242424242424242", amount: 49.99 },
          sensitiveDataFields: ["cardNumber"],
        },
        {},
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.id).toBe("K2");
    expect(result.hint).not.toBeNull();
    expect(result.message).toContain("cardNumber");
    expect(result.message).toMatch(/plain text/i);
  }, 30_000);

  it("PASSes narrowly when a configured sensitiveDataFields name isn't present anywhere in sampleInput — honestly reports nothing was actually checked", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkK2SensitiveDataNotExposed(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-k2-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "Alice",
          sensitiveDataFields: ["ssn"],
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("K2");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/ssn/i);
    expect(result.message).toMatch(/nothing/i);
  }, 30_000);
});
