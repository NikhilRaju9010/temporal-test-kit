import proto from "@temporalio/proto";
import type { History } from "@temporalio/common/lib/proto-utils.js";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "J1")!;

// Bounded internal wait for the workflow to reach a terminal state, mirroring
// I3's recordWorkflowHistory and J3's own wait — kept comfortably under the
// orchestrator's 15s per-check ceiling (see CLAUDE.md's "Per-check timeout
// and error isolation") so there's room left for fetchHistory() and our own
// bookkeeping before runCheckWithGuards would time this check out itself.
const WAIT_TIMEOUT_MS = 8_000;

const EventType = proto.temporal.api.enums.v1.EventType;

/**
 * The event types that make a workflow's ending legible in its own history —
 * whatever actually happened to it, one of these should be the last word.
 * (This intentionally excludes WorkflowExecutionContinuedAsNew, which is a
 * "this execution's story continues in a new run" event rather than a true
 * ending — out of scope for a zero-fixture check against a workflow started
 * with no args.)
 */
const TERMINAL_EVENT_TYPES = new Set<number>([
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED,
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED,
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_TERMINATED,
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED,
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT,
]);

const TERMINAL_EVENT_NAMES: Record<number, string> = {
  [EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED]: "WorkflowExecutionCompleted",
  [EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED]: "WorkflowExecutionFailed",
  [EventType.EVENT_TYPE_WORKFLOW_EXECUTION_TERMINATED]: "WorkflowExecutionTerminated",
  [EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED]: "WorkflowExecutionCanceled",
  [EventType.EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT]: "WorkflowExecutionTimedOut",
};

export interface RecordedHistory {
  history: History;
  workflowId: string;
  /** True if our bounded wait observed the workflow reach a terminal state (success or failure alike). */
  observedTerminal: boolean;
}

/**
 * Starts `target.workflowType` for real against a live worker and returns
 * its event history plus whether our bounded wait actually saw it finish.
 * Zero-fixture, so there's no sampleInput — the workflow runs with no args,
 * same as I3/J3. A workflow that's still running after the wait is not a
 * defect for this check to grade (see checkJ1EventHistory below): J1 only
 * asks whether the history coherently explains whatever state the workflow
 * is actually in, not whether it finished within our wait.
 */
export async function recordWorkflowHistory(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
): Promise<RecordedHistory> {
  const workflowId = generateWorkflowId("J1", target.workflowType);

  return withRunningWorker(env, target, async () => {
    const handle = await env.client.workflow.start(target.workflowType, {
      taskQueue: target.taskQueue,
      workflowId,
      args: [],
    });

    let observedTerminal = false;
    await raceWithTimeout(
      handle
        .result()
        .then(() => {
          observedTerminal = true;
        })
        .catch(() => {
          observedTerminal = true;
        }),
      WAIT_TIMEOUT_MS,
      () => undefined,
    );

    const history = await handle.fetchHistory();
    return { history, workflowId, observedTerminal };
  });
}

export interface HistoryValidation {
  ok: boolean;
  reason: string | null;
  /** Name of the terminal event found, if any (e.g. "WorkflowExecutionCompleted"). */
  terminalEventName: string | null;
}

/**
 * Structurally validates that `history` coherently records the whole story
 * of a workflow execution:
 *   - at least one event, and the first is WorkflowExecutionStarted
 *   - if a terminal event is present, it's a recognized one, and if it's
 *     WorkflowExecutionFailed, the failure carries a non-empty message
 * A history with no terminal event yet is not treated as invalid here — a
 * still-running workflow legitimately has no ending to record yet. That's
 * left to the caller to report explicitly rather than folding into "ok".
 */
export function validateHistoryStructure(history: History): HistoryValidation {
  const events = history.events ?? [];

  if (events.length === 0) {
    return { ok: false, reason: "the fetched history contains zero events", terminalEventName: null };
  }

  const first = events[0];
  if (first.eventType !== EventType.EVENT_TYPE_WORKFLOW_EXECUTION_STARTED) {
    return {
      ok: false,
      reason: `the first event in history is not WorkflowExecutionStarted (got eventType=${first.eventType})`,
      terminalEventName: null,
    };
  }

  const terminalEvent = events.find((e) => TERMINAL_EVENT_TYPES.has(e.eventType as number));
  if (!terminalEvent) {
    return { ok: true, reason: null, terminalEventName: null };
  }

  const terminalEventName = TERMINAL_EVENT_NAMES[terminalEvent.eventType as number];

  if (terminalEvent.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED) {
    const message = terminalEvent.workflowExecutionFailedEventAttributes?.failure?.message;
    if (!message || message.trim().length === 0) {
      return {
        ok: false,
        reason: "the WorkflowExecutionFailed event has no (or an empty) failure message",
        terminalEventName,
      };
    }
  }

  return { ok: true, reason: null, terminalEventName };
}

export async function checkJ1EventHistory(
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
      message: `Could not run ${target.workflowType} to record an event history: ${(e as Error).message}`,
      hint:
        "This check needs to run the workflow once and fetch its event history. This failure is about running " +
        "the workflow at all, not about the history's structure — check the worker boot/config first.",
    };
  }

  const validation = validateHistoryStructure(recorded.history);

  if (!validation.ok) {
    return {
      ...base,
      status: "FAIL",
      message: `${target.workflowType}'s event history is not structurally coherent: ${validation.reason}`,
      hint:
        "An incomplete or malformed event history means whoever operates this app can't reconstruct what " +
        "actually happened to a workflow from the Temporal Web UI — every terminal outcome (completed, failed, " +
        "terminated, canceled, timed out) needs to be clearly recorded, and a failure needs an actual message " +
        "explaining what went wrong, or debugging a failed workflow becomes guesswork.",
    };
  }

  if (validation.terminalEventName) {
    return {
      ...base,
      status: "PASS",
      message:
        `${target.workflowType}'s event history is structurally coherent: starts with WorkflowExecutionStarted ` +
        `and ends with ${validation.terminalEventName}.`,
      hint: null,
    };
  }

  // Still running after our bounded wait: not a structural defect for J1
  // (that's an A1-shaped "does it complete" concern) — the history so far
  // correctly starts, and there's nothing to grade about an ending it
  // hasn't reached yet.
  return {
    ...base,
    status: "PASS",
    message:
      `${target.workflowType} was still RUNNING after waiting ${WAIT_TIMEOUT_MS}ms — its history so far starts ` +
      "correctly with WorkflowExecutionStarted and has no terminal event yet, which is expected for a workflow " +
      "that hasn't finished.",
    hint: null,
  };
}
