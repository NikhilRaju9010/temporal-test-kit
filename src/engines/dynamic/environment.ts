import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { registerCleanup, runAllCleanups } from "./cleanup-registry.js";

export type EphemeralEnvironment = Awaited<ReturnType<typeof TestWorkflowEnvironment.createLocal>>;

export async function createEphemeralEnvironment(): Promise<EphemeralEnvironment> {
  return TestWorkflowEnvironment.createLocal();
}

export async function createTimeSkippingEnvironment(): Promise<EphemeralEnvironment> {
  return TestWorkflowEnvironment.createTimeSkipping();
}

/**
 * Runs `fn` against a fresh ephemeral environment, guaranteeing teardown
 * even if `fn` throws or the process receives SIGINT/SIGTERM mid-run.
 *
 * This environment's own teardown is registered in the shared cleanup
 * registry (`cleanup-registry.ts`) rather than torn down directly by the
 * signal handler — on SIGINT/SIGTERM, EVERY currently-registered resource
 * runs, not just this one. That matters once a check owns something this
 * function doesn't know about (I5/L1's own private `TestWorkflowEnvironment`,
 * I1's spawned child-process worker): before the registry existed, an
 * interrupt mid-check tore down only the main env and then called
 * `process.exit()`, which kills the process before that check's own
 * `finally` block runs — silently orphaning whatever it owned. Registering
 * here fixes that for this environment, and any check with its own
 * disposable resource gets the same protection by registering it too.
 */
export async function withEphemeralEnvironment<T>(
  fn: (env: EphemeralEnvironment) => Promise<T>,
  create: () => Promise<EphemeralEnvironment> = createEphemeralEnvironment,
  exit: typeof process.exit = process.exit,
): Promise<T> {
  const env = await create();

  let torndown = false;
  const teardown = async () => {
    if (torndown) return;
    torndown = true;
    await env.teardown();
  };
  const unregister = registerCleanup(teardown);
  const onSignal = () => {
    runAllCleanups().finally(() => exit(1));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    return await fn(env);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    unregister();
    await teardown();
  }
}

export interface WorkerTarget {
  workflowsPath: string;
  activities: Record<string, unknown>;
  taskQueue: string;
}

/**
 * THE single call site for `Worker.create()` in this codebase (enforced by
 * convention — see CLAUDE.md's "Worker lifecycle gotcha" section). Creates a
 * worker against the ephemeral environment's connection, starts it running,
 * lets `fn` do whatever it needs while the worker is live (start workflows,
 * send signals, etc.), then always shuts the worker down and awaits its
 * `run()` promise before returning — draining the connection reference that
 * `Worker.create()` leaves behind, which only `run()` completing releases.
 * Every check that needs a live worker must go through this (or `bootWorker`
 * below, which is just this with a no-op `fn`), never call `Worker.create()`
 * directly.
 */
export async function withRunningWorker<T>(
  env: EphemeralEnvironment,
  target: WorkerTarget,
  fn: (worker: Worker) => Promise<T>,
): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: target.taskQueue,
    workflowsPath: target.workflowsPath,
    activities: target.activities,
  });

  const runPromise = worker.run();
  runPromise.catch(() => {
    // Errors surface via the awaited runPromise below; this just prevents
    // an unhandled rejection while `fn` is still running.
  });

  try {
    return await fn(worker);
  } finally {
    worker.shutdown();
    await runPromise;
  }
}

export interface WorkerBootResult {
  booted: boolean;
  error: string | null;
}

/**
 * Starts the project's real worker against the ephemeral environment's
 * connection and confirms it registers (task queue bound, workflow bundle
 * compiled, activities resolved), without needing it to process anything.
 */
export async function bootWorker(env: EphemeralEnvironment, target: WorkerTarget): Promise<WorkerBootResult> {
  try {
    await withRunningWorker(env, target, async () => {});
    return { booted: true, error: null };
  } catch (e) {
    return { booted: false, error: (e as Error).message };
  }
}
