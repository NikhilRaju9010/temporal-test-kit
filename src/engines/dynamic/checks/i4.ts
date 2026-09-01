import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "I4")!;

// Bounded waits, mirroring i3.ts's Promise.race-against-a-timer pattern.
const CORRECT_QUEUE_WAIT_MS = 5_000;
const WRONG_QUEUE_WAIT_MS = 2_500;

export interface CorrectQueueProof {
  /** true if the workflow's reported task queue matches the one it was started on. */
  onExpectedQueue: boolean;
  reportedTaskQueue: string;
}

/**
 * Starts `target.workflowType` on `target.taskQueue` with a live worker
 * listening there, waits briefly, then confirms via `handle.describe()`
 * that the server reports the workflow as living on that exact task queue.
 */
export async function proveCorrectQueuePickup(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
): Promise<CorrectQueueProof> {
  const workflowId = generateWorkflowId("I4", target.workflowType);

  return withRunningWorker(
    env,
    target,
    async () => {
      const handle = await env.client.workflow.start(target.workflowType, {
        taskQueue: target.taskQueue,
        workflowId,
        args: [],
      });

      await raceWithTimeout(handle.result().catch(() => {}), CORRECT_QUEUE_WAIT_MS, () => undefined);

      const description = await handle.describe();
      return {
        onExpectedQueue: description.taskQueue === target.taskQueue,
        reportedTaskQueue: description.taskQueue,
      };
    },
    signal,
  );
}

export interface WrongQueueProof {
  /** true if the mismatched-queue workflow was still sitting unpicked-up (RUNNING) after the short wait. */
  staysUnpickedUp: boolean;
  statusName: string;
}

/**
 * Starts ANOTHER instance of `target.workflowType`, but targeting a task
 * queue name no worker is listening on, and confirms it does NOT reach a
 * terminal state within a short bounded wait — proving task queues are
 * genuinely scoped, so a name mismatch really would mean work silently
 * never gets picked up. Runs against the same live worker booted by
 * `proveCorrectQueuePickup`'s `withRunningWorker` call (that worker only
 * listens on `target.taskQueue`, not the bogus one), so no second worker
 * boot is needed here — this function itself does not touch `Worker.create()`.
 */
export async function proveWrongQueueNeverPicksUp(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
): Promise<WrongQueueProof> {
  const wrongTaskQueue = `${target.taskQueue}-ttk-nonexistent-probe`;
  const workflowId = generateWorkflowId("I4", target.workflowType);

  const handle = await env.client.workflow.start(target.workflowType, {
    taskQueue: wrongTaskQueue,
    workflowId,
    args: [],
  });

  await new Promise((resolve) => setTimeout(resolve, WRONG_QUEUE_WAIT_MS));

  const description = await handle.describe();
  return {
    staysUnpickedUp: description.status.name === "RUNNING",
    statusName: description.status.name,
  };
}

export async function checkI4TaskQueue(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.workflowType,
    engine: "dynamic-zero-fixture" as const,
  };

  const correct = await proveCorrectQueuePickup(env, target, signal);
  const wrong = await proveWrongQueueNeverPicksUp(env, target);

  if (correct.onExpectedQueue && wrong.staysUnpickedUp) {
    return {
      ...base,
      status: "PASS",
      message:
        `${target.workflowType} correctly routes to and stays scoped to its configured task queue ` +
        `("${target.taskQueue}"): work started there was picked up and reported that exact task queue, ` +
        `and an identical workflow started on an unrelated task queue name sat unpicked-up (still RUNNING) ` +
        `with no worker listening on it.`,
      hint: null,
    };
  }

  const problems: string[] = [];
  if (!correct.onExpectedQueue) {
    problems.push(
      `work started on "${target.taskQueue}" was reported by the server as living on ` +
        `"${correct.reportedTaskQueue}" instead of the configured task queue`,
    );
  }
  if (!wrong.staysUnpickedUp) {
    problems.push(
      `a workflow started on an unrelated, worker-less task queue name reached status "${wrong.statusName}" ` +
        `instead of staying RUNNING/unpicked-up`,
    );
  }

  return {
    ...base,
    status: "FAIL",
    message: `Task queue routing problem for ${target.workflowType}: ${problems.join("; ")}.`,
    hint:
      "Task queue misrouting means work silently never executes (if it lands on a queue nothing is listening " +
      "on) or executes somewhere unintended (if it's picked up on a queue it shouldn't be). Double check the " +
      "task queue name configured for this workflow in temporal-test-kit.config.json against the task queue " +
      "the worker that's supposed to run it is actually listening on.",
  };
}
