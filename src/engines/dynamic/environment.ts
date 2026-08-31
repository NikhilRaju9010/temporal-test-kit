import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

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
 */
export async function withEphemeralEnvironment<T>(
  fn: (env: EphemeralEnvironment) => Promise<T>,
  create: () => Promise<EphemeralEnvironment> = createEphemeralEnvironment,
): Promise<T> {
  const env = await create();

  let interrupted = false;
  const teardown = async () => {
    if (interrupted) return;
    interrupted = true;
    await env.teardown();
  };
  const onSignal = () => {
    teardown().finally(() => process.exit(1));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    return await fn(env);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
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
