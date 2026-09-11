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

  it("honors a waitBudgetsMs.C1.queryWaitMs override instead of the hardcoded default", async () => {
    // A real query round-trip over the socket takes more than 1ms, so this
    // deterministically hits the "did not resolve within Nms" branch even
    // though getStateQuery is a real, working handler — proving the
    // override (not the 5000ms default) bounded the wait.
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC1Signals(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c1-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          signals: [{ name: "pingSignal", payload: "hello-from-c1" }],
          queries: [{ name: "getStateQuery" }],
        },
        {},
        undefined,
        { C1: { queryWaitMs: 1 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/1ms/);
  }, 30_000);
});

const DELAYED_EFFECT_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "c1-delayed-effect-workflow.ts");

describe("checkC1Signals — polls for a real change instead of sampling the query once", () => {
  it("passes when a signal's handler mutates queryable state only after an await (previously a false FAIL)", async () => {
    // GreetingWorkflow here (from c1-delayed-effect-workflow.ts) has a
    // pingSignal handler that does `await sleep('300ms')` before mutating
    // the counter getCounterQuery reads. A single before/after sample taken
    // immediately after handle.signal() resolves would see no change yet —
    // reproduced against the pre-fix version of this check before landing
    // the poll loop below. This proves the fix, not just that PASS is
    // reachable some other way.
    const result = await withEphemeralEnvironment((env) =>
      checkC1Signals(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-c1-delayed-test",
          workflowsPath: DELAYED_EFFECT_WORKFLOWS_PATH,
          activities: {},
          signals: [{ name: "pingSignal", payload: undefined }],
          queries: [{ name: "getCounterQuery" }],
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.message).toMatch(/confirmed via getCounterQuery that state changed/i);
  }, 30_000);

  it("NEGATIVE CONTROL: still fails, after polling the full budget, when the signal genuinely never reaches a handler", async () => {
    const result = await withEphemeralEnvironment((env) =>
      checkC1Signals(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-c1-delayed-test-2",
          workflowsPath: DELAYED_EFFECT_WORKFLOWS_PATH,
          activities: {},
          signals: [{ name: "noSuchSignal", payload: undefined }],
          queries: [{ name: "getCounterQuery" }],
        },
        {},
        undefined,
        { C1: { queryWaitMs: 700 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/even after polling for up to 700ms/i);
  }, 30_000);
});
