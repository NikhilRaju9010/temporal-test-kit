import { Worker } from "@temporalio/worker";
import type { History } from "@temporalio/common/lib/proto-utils.js";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "I3")!;
const RUN_TIMEOUT_MS = 10_000;

export interface RecordedHistory {
  history: History;
  workflowId: string;
}

/**
 * Starts `target.workflowType` for real against a live worker and returns
 * its event history. Zero-fixture, so there's no sampleInput to pass — the
 * workflow is started with no args. Business-logic failures from missing
 * input are fine; a valid, replayable history is produced either way. Only
 * waits up to RUN_TIMEOUT_MS for the workflow to finish before fetching
 * history regardless of whether it completed (a workflow that legitimately
 * waits on a signal/query with no fixture data may still be running).
 */
export async function recordWorkflowHistory(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
): Promise<RecordedHistory> {
  const workflowId = generateWorkflowId("I3", target.workflowType);

  return withRunningWorker(env, target, async () => {
    const handle = await env.client.workflow.start(target.workflowType, {
      taskQueue: target.taskQueue,
      workflowId,
      args: [],
    });

    await Promise.race([
      handle.result().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, RUN_TIMEOUT_MS)),
    ]);

    const history = await handle.fetchHistory();
    return { history, workflowId };
  });
}

export interface ReplayResult {
  ok: boolean;
  error: string | null;
}

/** Replays `history` against the workflow code at `workflowsPath`, reporting any nondeterminism error. */
export async function replayHistory(
  workflowsPath: string,
  history: History,
  workflowId: string,
): Promise<ReplayResult> {
  try {
    await Worker.runReplayHistory({ workflowsPath }, history, workflowId);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function checkI3Replay(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.workflowType,
    engine: "dynamic-zero-fixture" as const,
  };

  let recorded: RecordedHistory;
  try {
    recorded = await recordWorkflowHistory(env, target);
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.workflowType} to record a history to replay: ${(e as Error).message}`,
      hint:
        "The replay check needs to run the workflow once to get an event history. " +
        "This failure is about running the workflow at all, not about replay determinism — check the worker boot/config first.",
    };
  }

  const replayed = await replayHistory(target.workflowsPath, recorded.history, recorded.workflowId);
  if (replayed.ok) {
    return {
      ...base,
      status: "PASS",
      message: `Replaying ${target.workflowType}'s recorded history against current code produced zero errors`,
      hint: null,
    };
  }

  return {
    ...base,
    status: "FAIL",
    message: `Replay error for ${target.workflowType}: ${replayed.error}`,
    hint:
      "A replay/nondeterminism error means the current workflow code diverges from what an already-recorded " +
      "execution expects — any in-flight workflow started under older code could fail or get stuck the moment " +
      "it hits this point. Common causes: reordering/adding/removing awaited operations (activities, timers, " +
      "signals) or using non-deterministic APIs directly in workflow code. Compare the workflow code against " +
      "what it looked like when this execution's history was recorded.",
  };
}
