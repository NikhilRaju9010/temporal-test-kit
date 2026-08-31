import { NativeConnection, Worker } from "@temporalio/worker";

/**
 * Generic bootstrap script for a REAL, killable OS child-process worker —
 * spawned by `spawnKillableWorker` (`child-worker.ts`), never run directly.
 * This is deliberately separate from `environment.ts`'s in-process
 * `withRunningWorker` path: that path's whole contract is graceful
 * shutdown-then-release, which is the opposite of what a check like I1
 * needs (a worker that can be killed ungracefully, task token abandoned, no
 * drain). An in-process `Worker` can't be forced into that state — the SDK
 * blocks closing its connection out from under it — so this script exists
 * to run a worker in a genuinely separate process that a real SIGKILL can
 * take out, the same way a real deployment's worker process can die.
 *
 * Configuration comes from environment variables, not argv/IPC, because
 * `activities`/`workflowsPath` are filesystem paths this process re-resolves
 * itself (mirroring the same `import(activitiesPath)` convention `cli.ts`
 * already uses for the in-process path) rather than values that could cross
 * a process boundary directly.
 *
 * Prints `WORKER_BOUND` to stdout once the worker is created and about to
 * start polling — `spawnKillableWorker` waits for this line before treating
 * the child as ready. There is deliberately NO shutdown handling here (no
 * SIGTERM listener, no `worker.shutdown()` call anywhere): the only way this
 * process ever stops is `worker.run()` throwing, or the process being
 * killed out from under it. Adding graceful shutdown would defeat the
 * purpose — a check that wants a well-behaved worker should use
 * `withRunningWorker` instead, not this.
 */
async function main(): Promise<void> {
  const address = requireEnv("TTK_ADDRESS");
  const namespace = process.env.TTK_NAMESPACE || "default";
  const taskQueue = requireEnv("TTK_TASK_QUEUE");
  const workflowsPath = requireEnv("TTK_WORKFLOWS_PATH");
  const activitiesPath = requireEnv("TTK_ACTIVITIES_PATH");

  const connection = await NativeConnection.connect({ address });
  const activities = await import(activitiesPath);

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities,
  });

  console.log("WORKER_BOUND");
  await worker.run();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`child-worker-entry: missing required env var ${name}`);
  }
  return value;
}

main().catch((e) => {
  console.error(`WORKER_ERROR: ${(e as Error).message}`);
  process.exit(1);
});
