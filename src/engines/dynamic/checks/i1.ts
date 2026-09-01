import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, createEphemeralEnvironment } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { spawnKillableWorker } from "../child-worker.js";
import { registerCleanup } from "../cleanup-registry.js";
import { raceWithTimeout } from "../race.js";
import { fixturePath } from "../fixture-path.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "I1")!;

const TASK_QUEUE = "ttk-i1";
const WORKFLOWS_PATH = fixturePath(import.meta.url, import.meta.dirname, "i1-side-effect-workflow");
const ACTIVITIES_PATH = fixturePath(import.meta.url, import.meta.dirname, "i1-activities");
const ACTIVITY_DELAY_MS = 1_500;
const MARKER_POLL_INTERVAL_MS = 50;
const MARKER_WAIT_TIMEOUT_MS = 10_000;
const RESULT_WAIT_MS = 25_000;

/**
 * I1 proves the real worker-crash recovery path: an activity task that a
 * worker was actively executing when that worker's OS process died
 * ungracefully (SIGKILL, no drain, task token abandoned) still gets
 * rescheduled onto a different worker and completes exactly once — not
 * zero times (work silently lost) and not more than once (a duplicated real
 * side effect).
 *
 * Like I5/D1, this is a property of Temporal's server+worker crash-recovery
 * mechanism itself, not of the target project's own workflow code — this
 * check does NOT exercise `target.workflowType`. It brings its own
 * throwaway probe (`fixtures/i1-side-effect-workflow.ts` +
 * `fixtures/i1-activities.ts`) whose activity writes a "started" marker
 * file the instant it begins (so this check knows precisely when to kill
 * the worker) and only appends to a separate "recorded" file once it runs
 * to completion — so an attempt killed mid-flight leaves no trace, and
 * counting that file's lines after the workflow finishes is a faithful
 * "did the real side effect happen more than once" check across the crash.
 *
 * Runs against its own private ephemeral environment (never the shared
 * `env` passed in) for the same reason I5 does: this check's worker
 * spawn/kill choreography must never interfere with the other checks
 * sharing the main environment. `env`/`target` are still accepted to keep
 * this check's signature shape consistent with every other check in this
 * engine.
 *
 * Uses `spawnKillableWorker` (child-worker.ts) for BOTH workers — the first
 * one specifically so it can be killed with a real SIGKILL (something an
 * in-process `Worker` cannot be forced into; see child-worker-entry.ts), and
 * the second one for consistency/simplicity even though it's only ever
 * killed gracefully-by-signal during this check's own cleanup.
 */
export async function checkI1WorkerCrashRecovery(
  _env: EphemeralEnvironment,
  _target: WorkerTarget & { workflowType: string },
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: "I1SideEffectWorkflow (internal probe)",
    engine: "dynamic-zero-fixture" as const,
  };

  const tmpDir = mkdtempSync(join(tmpdir(), "ttk-i1-"));
  const recordPath = join(tmpDir, "recorded.txt");
  const startedMarkerPath = join(tmpDir, "started.marker");

  const privateEnv = await createEphemeralEnvironment();
  let privateEnvTorndown = false;
  const teardownPrivateEnv = async () => {
    if (privateEnvTorndown) return;
    privateEnvTorndown = true;
    await privateEnv.teardown();
  };
  const unregisterPrivateEnvCleanup = registerCleanup(teardownPrivateEnv);

  try {
    const workflowId = generateWorkflowId("I1", "I1SideEffectWorkflow");

    const firstWorker = await spawnKillableWorker(privateEnv, {
      taskQueue: TASK_QUEUE,
      workflowsPath: WORKFLOWS_PATH,
      activitiesPath: ACTIVITIES_PATH,
    });

    let handle;
    try {
      handle = await privateEnv.client.workflow.start("I1SideEffectWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [recordPath, startedMarkerPath, ACTIVITY_DELAY_MS],
      });

      await waitForFile(startedMarkerPath, MARKER_WAIT_TIMEOUT_MS);
    } catch (e) {
      await firstWorker.kill();
      return {
        ...base,
        status: "FAIL",
        message: `Could not get the probe activity running on the first worker before crashing it: ${(e as Error).message}`,
        hint:
          "This check needs to observe the probe activity actually start before it can crash the worker mid-execution. " +
          "This failure is about setting up that observation, not about crash recovery itself — investigate the worker boot path first.",
      };
    }

    // The crash: kill the worker process that's mid-activity RIGHT NOW,
    // ungracefully. No drain, no shutdown() — this is what
    // spawnKillableWorker exists for.
    await firstWorker.kill();

    const secondWorker = await spawnKillableWorker(privateEnv, {
      taskQueue: TASK_QUEUE,
      workflowsPath: WORKFLOWS_PATH,
      activitiesPath: ACTIVITIES_PATH,
    });

    let error: Error | undefined;
    try {
      await raceWithTimeout(handle.result(), RESULT_WAIT_MS, () => {
        throw new Error(`workflow did not complete within ${RESULT_WAIT_MS}ms`);
      });
    } catch (e) {
      error = e as Error;
    } finally {
      await secondWorker.kill();
    }

    if (error) {
      return {
        ...base,
        status: "FAIL",
        message: `Probe workflow did not recover after its worker was killed mid-activity: ${error.message}`,
        hint:
          "After a worker crashes ungracefully while executing an activity, Temporal should reschedule that " +
          "activity task onto another available worker once it notices the original one is gone (via the " +
          "activity's timeout, since an abandoned task has no chance to fail cleanly on its own). If the " +
          "workflow never completes, work a worker was mid-way through can be silently lost on a real crash — " +
          "check the activity's startToCloseTimeout/retry policy configuration in the project under test.",
      };
    }

    const recordedCount = countLines(recordPath);

    if (recordedCount === 0) {
      return {
        ...base,
        status: "FAIL",
        message: "Probe workflow completed, but its activity's real side effect was never recorded at all.",
        hint:
          "The workflow reported success but the underlying work it was supposed to do never happened — this " +
          "would mean a crash during a real activity execution can silently lose the actual side effect (an " +
          "email never sent, a charge never made) while Temporal still reports the workflow as complete.",
      };
    }

    if (recordedCount > 1) {
      return {
        ...base,
        status: "FAIL",
        message: `Probe workflow's activity recorded its side effect ${recordedCount} times after a worker crash, expected exactly 1.`,
        hint:
          "A worker crash causing a retry should still produce exactly one real completion of the activity's " +
          "side effect. More than one means the crash + retry path can duplicate real work (e.g. sending an " +
          "email twice, charging a card twice) instead of cleanly recovering it — check whether the activity " +
          "in the project under test is safe to retry (idempotent) if it isn't already.",
      };
    }

    return {
      ...base,
      status: "PASS",
      message:
        "Killed the worker process while it was actively executing the probe activity (real SIGKILL, no drain), " +
        "and a fresh worker picked up the retry — the activity's real side effect was recorded exactly once " +
        "despite the crash. This check exercises an internal probe workflow, not the target project's own " +
        "workflow, since worker-crash recovery is a property of Temporal itself rather than of the project " +
        "under test.",
      hint: null,
    };
  } finally {
    unregisterPrivateEnvCleanup();
    await teardownPrivateEnv();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function waitForFile(path: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (fileExists(path)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`file ${path} did not appear within ${timeoutMs}ms`));
        return;
      }
      setTimeout(poll, MARKER_POLL_INTERVAL_MS);
    };
    poll();
  });
}

function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function countLines(path: string): number {
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}
