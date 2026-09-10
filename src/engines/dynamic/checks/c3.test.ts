import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkC3UpdateValidation } from "./c3.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkC3UpdateValidation — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].updates when unset (N_A/feature-flag gating happens in the orchestrator, not here)", async () => {
    const result = await checkC3UpdateValidation(FAKE_ENV, baseTarget, { updates: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C3");
    expect(result.hint).toContain("workflows[].updates");
  });
});

describe("checkC3UpdateValidation (real @temporalio/testing + sample project's InteractiveWorkflow)", () => {
  it("rejects invalidInput with state unchanged, then accepts validInput with state changed", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC3UpdateValidation(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c3-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          queries: [{ name: "getStateQuery" }],
          updates: [{ name: "changeStateUpdate", validInput: "NewName", invalidInput: "" }],
        },
        { updates: true },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("C3");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/reject/i);
  }, 30_000);

  it("reports FAIL when invalidInput is NOT actually rejected by the update", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC3UpdateValidation(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c3-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          queries: [{ name: "getStateQuery" }],
          // "AlsoValid" is a non-empty string, so InteractiveWorkflow's real
          // validator accepts it — this fixture mislabels it as invalid to
          // confirm the check actually catches a validator that doesn't reject.
          updates: [{ name: "changeStateUpdate", validInput: "NewName", invalidInput: "AlsoValid" }],
        },
        { updates: true },
      ),
    );

    expect(result.status).toBe("FAIL");
  }, 30_000);

  it("honors a waitBudgetsMs.C3.queryTimeoutMs override instead of the hardcoded default", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC3UpdateValidation(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c3-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          queries: [{ name: "getStateQuery" }],
          updates: [{ name: "changeStateUpdate", validInput: "NewName", invalidInput: "" }],
        },
        { updates: true },
        undefined,
        { C3: { queryTimeoutMs: 1 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/1ms/);
  }, 30_000);
});
