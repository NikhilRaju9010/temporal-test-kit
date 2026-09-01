import { describe, expect, it } from "vitest";
import { computeListLines } from "./list-command.js";
import { TestKitConfig } from "./config/schema.js";

const baseConfig: TestKitConfig = {
  project: "sample",
  workerEntryPoint: "./src/worker.ts",
  taskQueues: ["default"],
  workflows: [{ type: "GreetingWorkflow", taskQueue: "default" }],
};

describe("computeListLines", () => {
  it("marks every static check as would-run, regardless of config", () => {
    const lines = computeListLines(baseConfig);
    expect(lines.some((l) => l.includes("A2") && l.includes("would run"))).toBe(true);
  });

  it("marks every dynamic-zero-fixture check as would-run", () => {
    const lines = computeListLines(baseConfig);
    expect(lines.some((l) => l.includes("A1") && l.includes("would run"))).toBe(true);
  });

  it("marks every not-covered check as not-covered", () => {
    const lines = computeListLines(baseConfig);
    expect(lines.some((l) => l.includes("A5") && l.includes("not covered"))).toBe(true);
  });

  it("marks a dynamic-fixture check as needs-fixture, naming the field, when its config field is missing", () => {
    const lines = computeListLines(baseConfig);
    expect(lines.some((l) => l.includes("G1") && l.includes("needs fixture") && l.includes("workflows[].sagaFailurePoint"))).toBe(true);
  });

  it("marks a dynamic-fixture check as would-run when its config field is present", () => {
    const config: TestKitConfig = {
      ...baseConfig,
      workflows: [{ type: "GreetingWorkflow", taskQueue: "default", sagaFailurePoint: "chargeCardActivity" }],
    };
    const lines = computeListLines(config);
    expect(lines.some((l) => l.includes("G1") && l.includes("would run"))).toBe(true);
  });

  it("marks a feature-flag-gated dynamic-fixture check as N/A when the flag is unset", () => {
    const lines = computeListLines(baseConfig);
    expect(lines.some((l) => l.includes("C3") && l.includes("N/A") && l.includes("features.updates"))).toBe(true);
  });

  it("marks a feature-flag-gated dynamic-fixture check as needs-fixture (not N/A) once the flag is on but the per-workflow field is still missing", () => {
    const config: TestKitConfig = { ...baseConfig, features: { updates: true } };
    const lines = computeListLines(config);
    expect(lines.some((l) => l.includes("C3") && l.includes("needs fixture") && l.includes("workflows[].updates"))).toBe(true);
  });

  it("treats a boolean fixture field of exactly false as still needing fixture (not merely 'unset')", () => {
    const config: TestKitConfig = {
      ...baseConfig,
      workflows: [{ type: "GreetingWorkflow", taskQueue: "default", isLongRunning: false }],
    };
    const lines = computeListLines(config);
    expect(lines.some((l) => l.includes("E2") && l.includes("needs fixture"))).toBe(true);
  });

  it("resolves an 'X or Y' fixtureField as would-run if EITHER side is present", () => {
    const config: TestKitConfig = {
      ...baseConfig,
      workflows: [{ type: "GreetingWorkflow", taskQueue: "default", updates: [{ name: "u", validInput: 1, invalidInput: 2 }] }],
    };
    const lines = computeListLines(config);
    expect(lines.some((l) => l.includes("C5") && l.includes("would run"))).toBe(true);
  });

  it("marks D2/D3/D4 as 'would run' ONLY for the workflow matching features.scheduleWorkflowId, and as skipped (not would-run) for every other configured workflow — even though the field itself is present", () => {
    const config: TestKitConfig = {
      ...baseConfig,
      workflows: [
        { type: "GreetingWorkflow", taskQueue: "default" },
        { type: "SagaWorkflow", taskQueue: "saga" },
      ],
      features: { schedules: true, scheduleWorkflowId: "GreetingWorkflow" },
    };
    const lines = computeListLines(config);
    const d2Lines = lines.filter((l) => l.includes(" D2 "));
    expect(d2Lines).toHaveLength(2);
    expect(d2Lines.find((l) => l.includes("(GreetingWorkflow)"))).toMatch(/would run/);
    expect(d2Lines.find((l) => l.includes("(SagaWorkflow)"))).not.toMatch(/would run/);
  });

  it("lists dynamic checks once per configured workflow", () => {
    const config: TestKitConfig = {
      ...baseConfig,
      workflows: [
        { type: "GreetingWorkflow", taskQueue: "default" },
        { type: "SagaWorkflow", taskQueue: "saga", sagaFailurePoint: "chargeCardActivity" },
      ],
    };
    const lines = computeListLines(config);
    const g1Lines = lines.filter((l) => l.includes(" G1 "));
    expect(g1Lines).toHaveLength(2);
    expect(g1Lines.some((l) => l.includes("needs fixture"))).toBe(true);
    expect(g1Lines.some((l) => l.includes("would run"))).toBe(true);
  });
});
