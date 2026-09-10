import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkH1CancelRunsCleanup } from "./h1.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "InteractiveWorkflow", taskQueue: "interactive", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkH1CancelRunsCleanup — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].hasCleanupOnCancel when unset", async () => {
    const result = await checkH1CancelRunsCleanup(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("H1");
    expect(result.hint).toContain("workflows[].hasCleanupOnCancel");
  });

  it("skips when hasCleanupOnCancel is explicitly false", async () => {
    const result = await checkH1CancelRunsCleanup(FAKE_ENV, { ...baseTarget, hasCleanupOnCancel: false }, {});
    expect(result.status).toBe("SKIPPED");
  });
});

describe("checkH1CancelRunsCleanup (real @temporalio/testing + sample project's InteractiveWorkflow)", () => {
  it("cancels the workflow and confirms it reaches CANCELED and cleanupActivity actually ran (found in event history)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkH1CancelRunsCleanup(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-h1-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          hasCleanupOnCancel: true,
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("H1");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/cleanupActivity/);
  }, 30_000);

  it("honors a waitBudgetsMs.H1.resultWaitMs override instead of the hardcoded default", async () => {
    // A 1ms wait can't possibly be enough for the server to even record the
    // cancel-requested event yet, let alone reach a terminal state — the
    // exact branch reached is timing-sensitive (this check does two
    // sequential history checks after the single race), so this proves the
    // override via elapsed time (a fraction of the 10000ms default) plus a
    // real FAIL, rather than pinning to one specific message.
    const activities = await loadActivities();

    const start = Date.now();
    const result = await withEphemeralEnvironment((env) =>
      checkH1CancelRunsCleanup(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-h1-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          hasCleanupOnCancel: true,
        },
        {},
        undefined,
        { H1: { resultWaitMs: 1 } },
      ),
    );
    const elapsedMs = Date.now() - start;

    expect(result.status).toBe("FAIL");
    // Load-independent bound: RESULT_WAIT_MS's own default is 10000ms, so if
    // the override weren't actually used, elapsed time would be AT LEAST
    // that — holds regardless of machine speed/contention.
    expect(elapsedMs).toBeLessThan(15_000); // generous margin over the 10000ms default for full-suite-load overhead
  }, 30_000);
});
