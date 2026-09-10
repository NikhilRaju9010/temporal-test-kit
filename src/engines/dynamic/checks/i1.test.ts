import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkI1WorkerCrashRecovery } from "./i1.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkI1WorkerCrashRecovery (real @temporalio/testing + a real killed OS child process)", () => {
  it("kills the worker process mid-activity-execution, lets a fresh worker pick up the retry, and confirms the activity's real side effect happened exactly once", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkI1WorkerCrashRecovery(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("I1");
    expect(result.engine).toBe("dynamic-zero-fixture");
    // I1 exercises an internal probe workflow, not the target project's own
    // workflow — same convention as I5/D1 (see i1.ts's doc comment).
    expect(result.target).toBe("I1SideEffectWorkflow (internal probe)");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/exactly once/i);
  }, 45_000);

  it("honors a waitBudgetsMs.I1.markerWaitTimeoutMs override instead of the hardcoded default", async () => {
    // Spawning a real OS process and having it record its own "started"
    // marker file takes real seconds — a 1ms wait can't possibly be enough,
    // so this deterministically hits the "could not get the probe activity
    // running" FAIL branch, whose message embeds the exact wait value used.
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkI1WorkerCrashRecovery(
        env,
        {
          workflowType: "GreetingWorkflow",
          taskQueue: "default",
          workflowsPath: WORKFLOWS_PATH,
          activities,
        },
        undefined,
        { I1: { markerWaitTimeoutMs: 1 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/1ms/);
  }, 45_000);
});
