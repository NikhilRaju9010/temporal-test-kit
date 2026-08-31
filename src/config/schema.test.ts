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
});
