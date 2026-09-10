import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkE2ContinueAsNewStatePreserved } from "./e2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "CounterWorkflow", taskQueue: "counter", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkE2ContinueAsNewStatePreserved — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].isLongRunning when unset", async () => {
    const result = await checkE2ContinueAsNewStatePreserved(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("E2");
    expect(result.hint).toContain("workflows[].isLongRunning");
  });

  it("skips when isLongRunning is explicitly false", async () => {
    const result = await checkE2ContinueAsNewStatePreserved(FAKE_ENV, { ...baseTarget, isLongRunning: false }, {});
    expect(result.status).toBe("SKIPPED");
  });

  it("skips with a hint naming workflows[].signals when isLongRunning is true but no signal is configured", async () => {
    const result = await checkE2ContinueAsNewStatePreserved(FAKE_ENV, { ...baseTarget, isLongRunning: true }, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.hint).toContain("workflows[].signals");
  });
});

describe("checkE2ContinueAsNewStatePreserved (real @temporalio/testing + sample project's CounterWorkflow)", () => {
  it("confirms accumulated count survives continue-as-new and the workflow completes with the fully accumulated total", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkE2ContinueAsNewStatePreserved(
        env,
        {
          type: "CounterWorkflow",
          taskQueue: "ttk-e2-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: { count: 0 },
          isLongRunning: true,
          signals: [{ name: "incrementSignal", payload: null }],
          queries: [{ name: "getCountQuery" }],
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("E2");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/continue-as-new/i);
    // Not asserting an exact final count: Temporal can silently drop a
    // signal delivered right at a continueAsNew boundary (confirmed
    // empirically, a real SDK/protocol caveat — see e2.ts's SIGNAL_BUDGET
    // comment), so CounterWorkflow's 3-cycles-of-3 fixture design can
    // legitimately finish anywhere from 9 to SIGNAL_BUDGET signals
    // depending on how many landed exactly on a reset boundary that run.
    // The result being COMPLETED with a NOT-the-original-input carried
    // value (asserted via the /continue-as-new/i message match above,
    // which only appears in e2.ts's PASS branch) is what this test cares
    // about — not the specific number.
  }, 30_000);

  it("reports FAIL when the configured signal name doesn't exist on the workflow (never reaches continue-as-new)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkE2ContinueAsNewStatePreserved(
        env,
        {
          type: "CounterWorkflow",
          taskQueue: "ttk-e2-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: { count: 0 },
          isLongRunning: true,
          signals: [{ name: "noSuchSignal", payload: null }],
          queries: [{ name: "getCountQuery" }],
        },
        {},
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/continue-as-new|reset/i);
  }, 30_000);

  it("honors a waitBudgetsMs.E2.queryWaitMs override instead of the hardcoded default", async () => {
    // The baseline query (before any signals are sent) is a real round-trip
    // that takes more than 1ms, so this deterministically hits the "did not
    // resolve within Nms" branch — proving the override (not the 5000ms
    // default) bounded the wait.
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkE2ContinueAsNewStatePreserved(
        env,
        {
          type: "CounterWorkflow",
          taskQueue: "ttk-e2-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: { count: 0 },
          isLongRunning: true,
          signals: [{ name: "incrementSignal", payload: null }],
          queries: [{ name: "getCountQuery" }],
        },
        {},
        undefined,
        { E2: { queryWaitMs: 1 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/1ms/);
  }, 30_000);
});
