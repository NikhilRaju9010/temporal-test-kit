import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkC1Signals } from "./c1.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkC1Signals — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].signals when unset", async () => {
    const result = await checkC1Signals(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C1");
    expect(result.hint).toContain("workflows[].signals");
  });

  it("skips when signals is an empty array", async () => {
    const result = await checkC1Signals(FAKE_ENV, { ...baseTarget, signals: [] }, {});
    expect(result.status).toBe("SKIPPED");
  });
});

describe("checkC1Signals (real @temporalio/testing + sample project's InteractiveWorkflow)", () => {
  it("delivers each configured signal, confirms via query that state reflects it, and delivers a duplicate without erroring", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC1Signals(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c1-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          signals: [{ name: "pingSignal", payload: "hello-from-c1" }],
          queries: [{ name: "getStateQuery" }],
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("C1");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/duplicate/i);
  }, 30_000);

  it("reports FAIL when a configured signal name doesn't exist on the workflow", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC1Signals(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c1-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          signals: [{ name: "noSuchSignal", payload: "x" }],
          queries: [{ name: "getStateQuery" }],
        },
        {},
      ),
    );

    expect(result.status).toBe("FAIL");
  }, 30_000);
});
