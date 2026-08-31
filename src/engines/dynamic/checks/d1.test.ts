import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { createTimeSkippingEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkD1Timers, probeTimerSurvivesRestart } from "./d1.js";

const REAL_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "d1-timer-workflow.ts");
const NONEXISTENT_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "d1-does-not-exist.ts");

describe("checkD1Timers (real @temporalio/testing, no mocking)", () => {
  it("passes when a workflow's timer survives its worker shutting down and a new worker taking over", async () => {
    // checkD1Timers deliberately ignores the env/target it's handed (see the
    // doc comment on the check itself) and builds its own private
    // time-skipping environment + throwaway probe workflow — so any
    // ephemeral environment/target here is just satisfying the shared
    // check-function signature, never actually used by the check.
    const result = await withEphemeralEnvironment((env) =>
      checkD1Timers(env, {
        workflowType: "unused",
        taskQueue: "unused",
        workflowsPath: "unused",
        activities: {},
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("D1");
    expect(result.hint).toBeNull();
    expect(result.target).toBe("D1TimerWorkflow (internal probe)");
    expect(result.message).toMatch(/survived/i);
  }, 30_000);

  it("does not leak its private environment/connection across runs — running it twice back to back both pass", async () => {
    // If probeTimerSurvivesRestart's two Worker.create()/run()/shutdown()
    // cycles ever failed to release the connection reference cleanly,
    // checkD1Timers's own `privateEnv.teardown()` would throw
    // ("IllegalStateError: Cannot close connection while Workers hold a
    // reference to it" — the exact bug documented in CLAUDE.md's "Worker
    // lifecycle gotcha"). Running the whole check twice, sequentially, with
    // no shared state between runs, is empirical proof each run's private
    // environment is fully torn down before the next one starts.
    const env = await createTimeSkippingEnvironment();
    try {
      const target = { workflowType: "unused", taskQueue: "unused", workflowsPath: "unused", activities: {} };

      const first = await checkD1Timers(env, target);
      expect(first.status).toBe("PASS");

      const second = await checkD1Timers(env, target);
      expect(second.status).toBe("PASS");
    } finally {
      await env.teardown();
    }
  }, 60_000);
});

describe("probeTimerSurvivesRestart teardown safety (real @temporalio/testing, no mocking)", () => {
  it("throwing partway through (bad workflowsPath) still leaves the caller's environment cleanly tearable down", async () => {
    const env = await createTimeSkippingEnvironment();

    let thrown: Error | undefined;
    try {
      // A nonexistent workflowsPath makes Worker.create's bundling step
      // reject, forcing probeTimerSurvivesRestart to throw before it ever
      // reaches its own success/failure return paths.
      await probeTimerSurvivesRestart(env, NONEXISTENT_WORKFLOWS_PATH, "ttk-d1-teardown-test");
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeDefined();

    // The real assertion: even after that throw, the environment's
    // connection has no leaked worker reference holding it open — teardown
    // must succeed, not throw IllegalStateError.
    await expect(env.teardown()).resolves.toBeUndefined();
  }, 30_000);

  it("still completes and returns the expected result when run directly against a caller-owned environment", async () => {
    const env = await createTimeSkippingEnvironment();
    try {
      const probe = await probeTimerSurvivesRestart(env, REAL_WORKFLOWS_PATH, "ttk-d1-direct-test");
      expect(probe.error).toBeUndefined();
      expect(probe.result).toBe("timer fired");
    } finally {
      await env.teardown();
    }
  }, 30_000);
});
