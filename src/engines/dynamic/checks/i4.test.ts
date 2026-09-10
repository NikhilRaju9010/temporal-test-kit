import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkI4TaskQueue } from "./i4.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");
const HANGING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "i4-hanging-workflow.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkI4TaskQueue (real @temporalio/testing + sample project)", () => {
  it("passes when work started on the configured task queue is picked up there and work sent to a mismatched queue is not", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkI4TaskQueue(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("I4");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeNull();
  }, 30_000);

  it("honors a waitBudgetsMs.I4.correctQueueWaitMs override instead of the hardcoded default", async () => {
    // proveCorrectQueuePickup only needs handle.describe()'s reported task
    // queue, not completion, so a workflow that never completes still lets
    // the check reach a correct PASS with a much smaller override than the
    // 5000ms default. WRONG_QUEUE_WAIT_MS (2500ms, fixed/out of scope) still
    // runs on top of this, so the elapsed bound allows headroom for that.
    const activities = await loadActivities();

    const start = Date.now();
    const result = await withEphemeralEnvironment((env) =>
      checkI4TaskQueue(
        env,
        {
          workflowType: "GreetingWorkflow",
          taskQueue: "default",
          workflowsPath: HANGING_WORKFLOWS_PATH,
          activities,
        },
        undefined,
        { I4: { correctQueueWaitMs: 200 } },
      ),
    );
    const elapsedMs = Date.now() - start;

    expect(result.status).toBe("PASS");
    // Bound: if CORRECT_QUEUE_WAIT_MS's own default (5000ms) were used
    // instead of the override, elapsed time would be AT LEAST that PLUS the
    // fixed WRONG_QUEUE_WAIT_MS (2500ms) this check always also waits out —
    // 7500ms — plus worker-boot/env overhead. Under full-suite load that
    // overhead alone was observed pushing past 7500ms, so 11000ms keeps
    // real margin below what "default + overhead" would need.
    expect(elapsedMs).toBeLessThan(11_000);
  }, 30_000);
});
