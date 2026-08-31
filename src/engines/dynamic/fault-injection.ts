import { Worker } from "@temporalio/worker";
import { EphemeralEnvironment, WorkerTarget } from "./environment.js";
import { registerCleanup } from "./cleanup-registry.js";

/**
 * Boots a worker against `env` running the project's REAL activities and
 * workflow code, except for ONE named activity, which is replaced by
 * `replacement` — so a dynamic-fixture check can force a specific step to
 * fail (or behave any other injected way) without needing any cooperation
 * from the target project's own code. This is what G1 (saga/compensation),
 * L2 (dependency outage), and B3 (idempotency) all build on: each names one
 * activity via its own config field (`sagaFailurePoint`,
 * `dependencyOutageTestActivity`, `idempotencyTestActivity`) and this
 * function is how the tool actually makes that activity misbehave on
 * demand, generically, for any project.
 *
 * THIS IS A DOCUMENTED EXCEPTION to CLAUDE.md's "always boot through
 * withRunningWorker" rule, same category as D1/I5's two-sequential-worker
 * exception. `withRunningWorker` takes a `WorkerTarget`'s `activities` map
 * as-is and has no hook to substitute a single entry — fault injection's
 * whole point is running everything else UNCHANGED while swapping out just
 * one function, which `withRunningWorker`'s signature can't express. Rather
 * than bend that function to support an activities-override parameter
 * nothing else needs, this is its own small function that otherwise
 * reproduces `withRunningWorker`'s exact contract: create, run, always
 * shut down and await the run promise in a `finally` — AND, since this
 * calls `Worker.create()` directly, it registers that shutdown with the
 * shared cleanup registry (`cleanup-registry.ts`) itself, the same way
 * I1/L1's own directly-created resources do. Skipping that registration
 * would silently reintroduce the exact interrupt-time leak Phase 2b's
 * cleanup-registry work fixed — a fault-injection worker orphaned on
 * Ctrl+C, undoing that guarantee for every fixture check built on this.
 */
export async function withFaultInjectedWorker<T>(
  env: EphemeralEnvironment,
  target: WorkerTarget,
  faultActivityName: string,
  replacement: (...args: unknown[]) => unknown,
  fn: (worker: Worker) => Promise<T>,
): Promise<T> {
  if (!(faultActivityName in target.activities)) {
    throw new Error(
      `withFaultInjectedWorker: "${faultActivityName}" is not an exported activity in this project's activities module`,
    );
  }

  const activities = { ...target.activities, [faultActivityName]: replacement };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: target.taskQueue,
    workflowsPath: target.workflowsPath,
    activities,
  });

  const runPromise = worker.run();
  runPromise.catch(() => {
    // Errors surface via the awaited runPromise below; this just prevents
    // an unhandled rejection while `fn` is still running.
  });

  let shutdown = false;
  const shutdownOnce = async () => {
    if (shutdown) return;
    shutdown = true;
    worker.shutdown();
    await runPromise;
  };
  const unregister = registerCleanup(shutdownOnce);

  try {
    return await fn(worker);
  } finally {
    unregister();
    await shutdownOnce();
  }
}
