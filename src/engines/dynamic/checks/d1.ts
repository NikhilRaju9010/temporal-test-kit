import { Worker } from "@temporalio/worker";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, createTimeSkippingEnvironment } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";
import { fixturePath } from "../fixture-path.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "D1")!;

const TASK_QUEUE = "ttk-d1";
const WORKFLOWS_PATH = fixturePath(import.meta.url, import.meta.dirname, "d1-timer-workflow");
const RESULT_WAIT_MS = 10_000;

/**
 * D1 proves that a workflow's in-flight TIMER survives its worker going away
 * and a *new* worker coming back — timer state lives in the workflow's event
 * history on the Temporal SERVER, not in the worker process, so this is a
 * test of server-side durability plus the SDK's ability to pick back up
 * correctly. It is NOT a test of worker-crash fidelity — that's I1 (a
 * different, separately-investigated check), which specifically needs to
 * simulate an ungraceful process CRASH, something our in-process worker
 * architecture can't do faithfully. D1 only needs a worker to stop and a new
 * worker to start later (gracefully or not — the *how* doesn't matter to
 * what's being verified), which `withRunningWorker`'s create-run-shutdown
 * pattern, used twice in sequence here, does faithfully.
 *
 * Because this is a property of Temporal itself rather than of the project
 * under test, this check does NOT use the `env` or `target.workflowType`
 * arguments it's handed — it builds its own throwaway timer-workflow fixture
 * (`fixtures/d1-timer-workflow.ts`) and runs it against a private,
 * time-skipping ephemeral environment created and torn down entirely inside
 * this function. Two reasons: (1) we have no fixture data telling us the
 * target project even uses timers — that's Phase 3 scope — so a fixture we
 * fully control is the only way to reliably exercise this property; (2) a
 * private environment means D1's worker-stop/worker-start choreography can
 * never interfere with, or be interfered with by, the other 15 zero-fixture
 * checks sharing the main `env`. `target`/`env` are still accepted so this
 * check keeps the same signature shape as every other check in this engine.
 * The returned `TestResult.target` names the internal probe workflow instead
 * of `target.workflowType` for the same reason, and the check's `message`
 * says so explicitly so this doesn't read as an oversight.
 */
export interface TimerRestartProbeResult {
  result?: string;
  error?: Error;
}

/**
 * The actual worker-stop/worker-restart choreography, factored out of
 * `checkD1Timers` so it can be exercised directly in tests against a
 * caller-owned environment — including deliberately-broken inputs (e.g. a
 * bad `workflowsPath`) that force it to throw, to prove the *caller's*
 * teardown still runs cleanly afterward. `checkD1Timers` itself always calls
 * this against its own private environment.
 *
 * NOTE ON THE Worker.create() CALLS BELOW: CLAUDE.md's "always boot through
 * withRunningWorker" rule exists to guard against a specific
 * connection-reference leak on the SHARED environment/connection
 * (Worker.create() registers a reference that only worker.run()'s
 * finally-block releases). This check is the one deliberate exception, for a
 * structural reason `withRunningWorker` can't accommodate: D1 needs to stop
 * the FIRST worker (mid-callback, before the workflow finishes) and then
 * start a SECOND worker afterward, both against the same private
 * environment — `withRunningWorker` only supports a single
 * create-run-shutdown cycle per call. So this function calls
 * `Worker.create()` / `worker.run()` / `worker.shutdown()` directly, twice,
 * but still follows the exact same run-then-shutdown-then-await pattern
 * `withRunningWorker` uses internally each time, so the connection reference
 * is cleanly released no matter how this function exits — success, a FAIL
 * result, or a thrown error — leaving the caller's `env.teardown()` free to
 * succeed. This is scoped to this ONE check only — no other check should
 * follow this example; go through `withRunningWorker` instead.
 */
export async function probeTimerSurvivesRestart(
  env: EphemeralEnvironment,
  workflowsPath: string,
  taskQueue: string,
): Promise<TimerRestartProbeResult> {
  const workflowId = generateWorkflowId("D1", "D1TimerWorkflow");

  // maxCachedWorkflows: 0 disables the SDK's sticky-task-queue optimization
  // (which pins a running workflow's subsequent tasks to the specific
  // worker process that last handled it, for efficiency). That pinning is
  // exactly what a genuine worker restart also blows away in production —
  // a brand-new process has no warm cache — so disabling it here matches
  // real restart semantics and lets the *second* worker pick the workflow
  // straight back up off the plain task queue, instead of the server having
  // to wait out the (real, non-time-skippable) sticky-queue schedule-to-start
  // timeout for the now-dead first worker before falling back.
  const firstWorker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: {},
    maxCachedWorkflows: 0,
  });
  const firstRunPromise = firstWorker.run();
  firstRunPromise.catch(() => {
    // Surfaced via the awaited promise below; this just avoids an
    // unhandled rejection while the workflow is starting.
  });

  try {
    const handle = await env.client.workflow.start("D1TimerWorkflow", {
      taskQueue,
      workflowId,
      args: [],
    });

    // Give the workflow a brief moment to actually start and enter its
    // sleep before we pull the first worker out from under it.
    await new Promise((resolve) => setTimeout(resolve, 500));

    firstWorker.shutdown();
    await firstRunPromise;

    // Second, fresh worker — simulates a worker restart. The timer is now
    // relying purely on server-side state to be picked back up correctly.
    const secondWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath,
      activities: {},
      maxCachedWorkflows: 0,
    });
    const secondRunPromise = secondWorker.run();
    secondRunPromise.catch(() => {});

    try {
      const result = await raceWithTimeout(handle.result(), RESULT_WAIT_MS, () => {
        throw new Error(`workflow did not complete within ${RESULT_WAIT_MS}ms`);
      });
      return { result: result as string };
    } catch (e) {
      return { error: e as Error };
    } finally {
      secondWorker.shutdown();
      await secondRunPromise;
    }
  } finally {
    // Covers the case where something above (workflow start, etc.) throws
    // before the first worker is ever explicitly shut down — make sure it
    // still is, so the connection reference is always released.
    const state = firstWorker.getState();
    if (state !== "STOPPED" && state !== "STOPPING" && state !== "DRAINED") {
      firstWorker.shutdown();
    }
    await firstRunPromise.catch(() => {});
  }
}

export async function checkD1Timers(
  _env: EphemeralEnvironment,
  _target: WorkerTarget & { workflowType: string },
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: "D1TimerWorkflow (internal probe)",
    engine: "dynamic-zero-fixture" as const,
  };

  // Private environment — deliberately NOT the shared `env` passed in. See
  // the doc comment above the exports. Time-skipping per the build spec's
  // guidance for timer-based tests, and because it lets the 3s sleep resolve
  // quickly in real wall-clock time too (time-skipping environments still
  // run real workers/timers correctly for durability purposes; they just
  // don't force us to burn 3 real seconds waiting on the client side).
  const privateEnv = await createTimeSkippingEnvironment();

  try {
    const probe = await probeTimerSurvivesRestart(privateEnv, WORKFLOWS_PATH, TASK_QUEUE);

    if (probe.error) {
      return {
        ...base,
        status: "FAIL",
        message: `Timer-based probe workflow did not complete after a worker restart: ${probe.error.message}`,
        hint:
          "This check starts an internal probe workflow (not the target project's own workflow — D1 tests a " +
          "property of Temporal itself, independent of any project code) that sleeps for 3 seconds, stops its " +
          "worker mid-sleep, and starts a brand-new worker to pick it back up. If the timer doesn't survive that " +
          "gap, any in-flight sleep()/timer-based workflow in the target project could get stuck or lose time " +
          "whenever a worker restarts — deploys, crashes, or scaling events all cause exactly this kind of gap.",
      };
    }

    if (probe.result !== "timer fired") {
      return {
        ...base,
        status: "FAIL",
        message: `Timer-based probe workflow completed with an unexpected result after a worker restart: ${JSON.stringify(probe.result)}`,
        hint:
          "The probe workflow was expected to return 'timer fired' after its sleep(). An unexpected result after " +
          "a worker restart suggests the timer or workflow state wasn't picked back up correctly by the new worker.",
      };
    }

    return {
      ...base,
      status: "PASS",
      message:
        "Internal probe workflow's 3-second timer survived its worker shutting down and a brand-new worker " +
        "taking over — timer state is durably held server-side and correctly picked back up. This check exercises " +
        "an internal probe workflow, not the target project's own workflow, since timer durability is a property " +
        "of Temporal itself rather than of the project under test.",
      hint: null,
    };
  } finally {
    await privateEnv.teardown();
  }
}
