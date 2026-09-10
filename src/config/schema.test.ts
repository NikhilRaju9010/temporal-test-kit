import { describe, expect, it } from "vitest";
import { validateConfig } from "./schema.js";

describe("validateConfig", () => {
  it("accepts a minimal valid config", () => {
    const result = validateConfig({
      project: "sample",
      workerEntryPoint: "./src/worker.ts",
      taskQueues: ["default"],
      workflows: [{ type: "GreetingWorkflow", taskQueue: "default" }],
    });

    expect(result.valid).toBe(true);
  });

  it("rejects a config missing workerEntryPoint", () => {
    const result = validateConfig({
      project: "sample",
      taskQueues: ["default"],
      workflows: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("workerEntryPoint is required and must be a string");
  });

  it("rejects a workflow missing a taskQueue", () => {
    const result = validateConfig({
      project: "sample",
      workerEntryPoint: "./src/worker.ts",
      taskQueues: ["default"],
      workflows: [{ type: "GreetingWorkflow" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("workflows[0].taskQueue is required and must be a string");
  });

  it("accepts a workflow with every Appendix A fixture field filled in", () => {
    const result = validateConfig({
      project: "sample",
      workerEntryPoint: "./src/worker.ts",
      taskQueues: ["default"],
      workflows: [
        {
          type: "OrderWorkflow",
          taskQueue: "orders",
          sampleInput: { orderId: "TEST-001" },
          isLongRunning: false,
          usesTimers: true,
          signals: [{ name: "cancelOrder", payload: {} }],
          queries: [{ name: "getStatus" }],
          updates: [{ name: "changeAddress", validInput: { address: "123 Main St" }, invalidInput: { address: "" } }],
          sagaFailurePoint: "chargeCardActivity",
          idempotencyTestActivity: "sendConfirmationEmailActivity",
          hasCleanupOnCancel: true,
          hasChildWorkflows: false,
          sensitiveDataFields: ["cardNumber", "cvv"],
          dependencyOutageTestActivity: "chargeCardActivity",
        },
      ],
      features: {
        childWorkflows: false,
        schedules: true,
        scheduleWorkflowId: "daily-rollover-schedule",
        searchAttributes: true,
        customSearchAttributeKeys: ["OrderStatus"],
        customDataConverter: false,
        dataConverterModulePath: null,
      },
      outputDir: "./temporal-test-kit-report",
    });

    expect(result.valid).toBe(true);
  });

  it("accepts a workflow with none of the optional fixture fields set", () => {
    const result = validateConfig({
      project: "sample",
      workerEntryPoint: "./src/worker.ts",
      taskQueues: ["default"],
      workflows: [{ type: "NotifyUserWorkflow", taskQueue: "notifications" }],
    });

    expect(result.valid).toBe(true);
  });

  it("rejects a workflow whose signals field is not an array", () => {
    const result = validateConfig({
      project: "sample",
      workerEntryPoint: "./src/worker.ts",
      taskQueues: ["default"],
      workflows: [{ type: "OrderWorkflow", taskQueue: "orders", signals: "not-an-array" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("workflows[0].signals must be an array");
  });

  it("rejects a signal entry missing a name", () => {
    const result = validateConfig({
      project: "sample",
      workerEntryPoint: "./src/worker.ts",
      taskQueues: ["default"],
      workflows: [{ type: "OrderWorkflow", taskQueue: "orders", signals: [{ payload: {} }] }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("workflows[0].signals[0].name is required and must be a string");
  });

  it("rejects an update entry missing validInput/invalidInput", () => {
    const result = validateConfig({
      project: "sample",
      workerEntryPoint: "./src/worker.ts",
      taskQueues: ["default"],
      workflows: [{ type: "OrderWorkflow", taskQueue: "orders", updates: [{ name: "changeAddress" }] }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("workflows[0].updates[0] must have both validInput and invalidInput");
  });

  it("rejects features when it's not an object", () => {
    const result = validateConfig({
      project: "sample",
      workerEntryPoint: "./src/worker.ts",
      taskQueues: ["default"],
      workflows: [],
      features: "not-an-object",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("features must be an object");
  });

  describe("waitBudgetsMs", () => {
    it("accepts a config with no waitBudgetsMs at all", () => {
      const result = validateConfig({
        project: "sample",
        workerEntryPoint: "./src/worker.ts",
        taskQueues: ["default"],
        workflows: [{ type: "T", taskQueue: "q" }],
      });
      expect(result.valid).toBe(true);
    });

    it("accepts a valid waitBudgetsMs override", () => {
      const result = validateConfig({
        project: "sample",
        workerEntryPoint: "./src/worker.ts",
        taskQueues: ["default"],
        workflows: [{ type: "T", taskQueue: "q" }],
        waitBudgetsMs: { A1: { waitTimeoutMs: 12000 }, F2: { childStartTimeoutMs: 9000 } },
      });
      expect(result.valid).toBe(true);
    });

    it("rejects a non-numeric wait budget value", () => {
      const result = validateConfig({
        project: "sample",
        workerEntryPoint: "./src/worker.ts",
        taskQueues: ["default"],
        workflows: [{ type: "T", taskQueue: "q" }],
        waitBudgetsMs: { A1: { waitTimeoutMs: "fast" } },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("waitBudgetsMs.A1.waitTimeoutMs must be a positive number");
    });

    it("rejects a negative or zero wait budget value", () => {
      const result = validateConfig({
        project: "sample",
        workerEntryPoint: "./src/worker.ts",
        taskQueues: ["default"],
        workflows: [{ type: "T", taskQueue: "q" }],
        waitBudgetsMs: { B5: { gracePeriodMs: 0 } },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("waitBudgetsMs.B5.gracePeriodMs must be a positive number");
    });

    it("rejects an unknown check ID under waitBudgetsMs", () => {
      const result = validateConfig({
        project: "sample",
        workerEntryPoint: "./src/worker.ts",
        taskQueues: ["default"],
        workflows: [{ type: "T", taskQueue: "q" }],
        waitBudgetsMs: { Z9: { somethingMs: 100 } },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("waitBudgetsMs.Z9 is not a recognized check ID with a configurable wait budget");
    });
  });
});
