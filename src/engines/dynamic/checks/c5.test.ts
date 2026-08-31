import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkC5NoStuckOnSignalUpdate } from "./c5.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkC5NoStuckOnSignalUpdate — SKIPPED when its fixture is missing", () => {
  it("skips when neither signals nor updates are configured", async () => {
    const result = await checkC5NoStuckOnSignalUpdate(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C5");
    expect(result.hint).toMatch(/workflows\[\]\.(signals|updates)/);
  });
});

describe("checkC5NoStuckOnSignalUpdate (real @temporalio/testing + sample project's InteractiveWorkflow)", () => {
  it("sends a rapid sequence of signals/updates and confirms the workflow still responds normally afterward", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC5NoStuckOnSignalUpdate(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c5-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          signals: [{ name: "pingSignal", payload: "rapid-ping" }],
          queries: [{ name: "getStateQuery" }],
          updates: [{ name: "changeStateUpdate", validInput: "NewName", invalidInput: "" }],
        },
        { updates: true },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("C5");
    expect(result.hint).toBeNull();
  }, 30_000);
});
