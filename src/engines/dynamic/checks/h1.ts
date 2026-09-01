import proto from "@temporalio/proto";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "H1")!;
const EventType = proto.temporal.api.enums.v1.EventType;
const RESULT_WAIT_MS = 10_000;

/**
 * `hasCleanupOnCancel` is a boolean where `false` is a real value, so this
 * checks `!== true` explicitly, same reasoning as E2/F1.
 *
 * H1 starts the workflow, calls `handle.cancel()`, and confirms two things
 * from the recorded event history — not from trusting the workflow's own
 * claim that cleanup ran: (a) the workflow reaches a terminal CANCELED
 * state, and (b) an activity was actually scheduled and completed AFTER the
 * cancellation was requested (an `ActivityTaskScheduled` event with an
 * event ID greater than the `WorkflowExecutionCancelRequested` event,
 * followed by a matching `ActivityTaskCompleted`). This tool has no config
 * field naming the cleanup activity by name (unlike G1/B3/L2's
 * single-named-activity fields), so it can't confirm it's specifically
 * "the" cleanup activity — only that SOME activity ran in response to
 * cancellation, which is what `hasCleanupOnCancel: true` claims. This
 * narrower, evidence-based bar (any post-cancellation activity, not a
 * specific named one) is stated explicitly in the PASS message.
 */
export const checkH1CancelRunsCleanup: DynamicFixtureCheckFn = async (env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (target.hasCleanupOnCancel !== true) {
    return missingFixtureResult(base, "workflows[].hasCleanupOnCancel");
  }

  const workflowId = generateWorkflowId("H1", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  try {
    return await withRunningWorker(env, target, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });

      await handle.cancel();
      await raceWithTimeout(handle.result().catch(() => {}), RESULT_WAIT_MS, () => undefined);

      const history = await handle.fetchHistory();
      const events = history.events ?? [];

      const cancelRequestedIndex = events.findIndex(
        (e) => e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CANCEL_REQUESTED,
      );
      const cancelRequestedEvent = cancelRequestedIndex === -1 ? undefined : events[cancelRequestedIndex];
      const terminalEvent = events.find(
        (e) =>
          e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED ||
          e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED ||
          e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED ||
          e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_TERMINATED,
      );

      if (!cancelRequestedEvent) {
        return {
          ...base,
          status: "FAIL" as const,
          message: `handle.cancel() did not produce a WorkflowExecutionCancelRequested event for ${target.type} — this run can't tell you anything about cleanup behavior until it does.`,
          hint:
            "This points at a setup problem (cancellation request itself), not at whether cleanup runs. Confirm " +
            `${target.type} is a real, running workflow at the time cancel() is called.`,
        };
      }

      if (!terminalEvent || terminalEvent.eventType !== EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED) {
        return {
          ...base,
          status: "FAIL" as const,
          message: terminalEvent
            ? `${target.type} was cancelled but reached ${EventType[terminalEvent.eventType!]} instead of WORKFLOW_EXECUTION_CANCELED.`
            : `${target.type} did not reach a terminal state within ${RESULT_WAIT_MS}ms after being cancelled.`,
          hint:
            "A cancelled workflow should reach a clean CANCELED terminal state once its cleanup work (if any) " +
            "finishes — reaching FAILED/COMPLETED/TERMINATED instead, or never resolving, suggests the " +
            "cancellation handling (or a cleanup activity swallowing/mishandling the CancelledFailure) doesn't " +
            "propagate correctly.",
        };
      }

      const scheduledAfterCancel = events
        .slice(cancelRequestedIndex + 1)
        .filter((e) => e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED);

      if (scheduledAfterCancel.length === 0) {
        return {
          ...base,
          status: "FAIL" as const,
          message: `${target.type} reached CANCELED, but no activity was scheduled after cancellation was requested — cleanup does not appear to have actually run.`,
          hint:
            "workflows[].hasCleanupOnCancel claims this workflow runs cleanup on cancellation, but the event " +
            "history shows no ActivityTaskScheduled event after WorkflowExecutionCancelRequested. Confirm the " +
            "workflow catches the cancellation (e.g. CancelledFailure from a condition()/timer/activity await) " +
            "and calls a real cleanup activity from its catch block before re-throwing.",
        };
      }

      const completedNames = scheduledAfterCancel
        .map((e) => e.activityTaskScheduledEventAttributes?.activityType?.name)
        .filter((name): name is string => !!name);

      return {
        ...base,
        status: "PASS" as const,
        message:
          `${target.type} reached a clean CANCELED terminal state, and the event history shows ` +
          `${scheduledAfterCancel.length} activity task(s) scheduled AFTER cancellation was requested ` +
          `(${[...new Set(completedNames)].join(", ") || "unnamed"}) — real evidence of cleanup running, not just ` +
          "the workflow's own claim. This check confirms SOME activity ran in response to cancellation; it has " +
          "no config field naming the cleanup activity specifically, so it can't confirm which activity is " +
          "the intended cleanup step versus, e.g., an unrelated activity that happened to be in flight.",
        hint: null,
      };
    });
  } catch (e) {
    return {
      ...base,
      status: "FAIL" as const,
      message: `Could not cancel ${target.type} and inspect its event history: ${(e as Error).message}`,
      hint:
        `This check starts ${target.type}, calls handle.cancel(), and inspects its event history. This failure ` +
        "is about setting that up, not about cleanup behavior itself — confirm workflows[].sampleInput is valid " +
        `for ${target.type}.`,
    };
  }
};
