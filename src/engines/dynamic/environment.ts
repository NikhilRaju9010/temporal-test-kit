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

export interface WorkerBootResult {
  booted: boolean;
  error: string | null;
}

/**
 * Starts the project's real worker against the ephemeral environment's
 * connection and confirms it registers. `Worker.create()` alone proves
 * registration (task queue bound, workflow bundle compiled, activities
 * resolved) but leaves a reference on the shared connection that only gets
 * released once `run()` completes — so this immediately requests shutdown
 * and awaits `run()` to drain that reference before returning, otherwise
 * `env.teardown()` throws IllegalStateError ("Workers hold a reference").
 */
export async function bootWorker(
  env: EphemeralEnvironment,
  options: {
    workflowsPath: string;
    activities: Record<string, unknown>;
    taskQueue: string;
  },
): Promise<WorkerBootResult> {
  let worker: Worker;
  try {
    worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: options.taskQueue,
      workflowsPath: options.workflowsPath,
      activities: options.activities,
    });
  } catch (e) {
    return { booted: false, error: (e as Error).message };
  }

  try {
    const runPromise = worker.run();
    worker.shutdown();
    await runPromise;
    return { booted: true, error: null };
  } catch (e) {
    return { booted: false, error: (e as Error).message };
  }
}
