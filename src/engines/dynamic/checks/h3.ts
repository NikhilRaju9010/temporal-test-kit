import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { EventType, findChildWorkflowId } from "../child-workflow-events.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "H3")!;
const CHILD_START_TIMEOUT_MS = 6_000;
const CHILD_START_POLL_INTERVAL_MS = 200;
const RESULT_WAIT_MS = 10_000;

/**
 * `hasChildWorkflows` is a boolean where `false` is a real value, so this
 * checks `!== true` explicitly, same reasoning as F1/F2/H1.
 *
 * H3 cancels a RUNNING parent (`handle.cancel()`) while its child is
 * genuinely in flight, and confirms the cancellation actually propagated
 * somewhere observable — not just that the parent's own execution ended.
 *
 * Unlike F2, this check does NOT need an "ABANDON-honesty" branch that
 * treats a still-running child as potentially-correct-depending-on-policy.
 * That's because an explicit, in-workflow cancellation (what `handle.cancel()`
 * triggers) and a parent CLOSING (what F2's `handle.terminate()` triggers)
 * are governed by two entirely different, independent SDK mechanisms:
 * `ParentClosePolicy` (F2's concern) only applies when the parent reaches a
 * Closed state some other way — most concretely, forceful termination,
 * which bypasses workflow code entirely, so only the SERVER can decide the
 * child's fate. An explicit cancel, by contrast, cancels the parent's own
 * `CancellationScope` from WITHIN running workflow code, and Temporal
 * propagates that to any child started in a cancellable scope by default
 * (`ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED`) — sample-
 * project's `ParentWorkflow` doesn't override this, so cancelling it always
 * propagates to `ChildWorkflow`, regardless of whatever `parentClosePolicy`
 * value its `sampleInput` selects. See `workflows.ts`'s `ParentWorkflow` doc
 * comment for the same distinction from the fixture's side.
 *
 * What's checked, from real event history (not the workflow's own claim):
 *   1. The child's OWN history shows a `WorkflowExecutionCancelRequested`
 *      event — proof the cancellation actually reached the child, the same
 *      generic, evidence-based standard H1 applies to cleanup activities.
 *   2. The parent reaches a clean terminal CANCELED state (not FAILED —
 *      which would mean the parent's own catch block mis-handled the
 *      CancelledFailure it received, wrapping it into an application
 *      failure instead of letting normal cancellation semantics through —
 *      and not stuck RUNNING).
 * This check does NOT require the child itself to end up CANCELED — the
 * SDK's own docs are explicit that a child MAY legitimately ignore a
 * cancellation request and complete on its own terms; only PROPAGATION
 * (the CancelRequested event actually reaching it) is what this check can
 * honestly claim to verify generically.
 */
export const checkH3CancelParentHandlesChildren: DynamicFixtureCheckFn = async (env, target, _features, signal) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (target.hasChildWorkflows !== true) {
    return missingFixtureResult(base, "workflows[].hasChildWorkflows");
  }

  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];
  const workflowId = generateWorkflowId("H3", target.type);

  try {
    return await withRunningWorker(env, target, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });

      let childWorkflowId: string | undefined;
      const discoverDeadline = Date.now() + CHILD_START_TIMEOUT_MS;
      while (Date.now() < discoverDeadline && !childWorkflowId) {
        const history = await handle.fetchHistory();
        childWorkflowId = findChildWorkflowId(history.events ?? []);
        if (!childWorkflowId) {
          await new Promise((resolve) => setTimeout(resolve, CHILD_START_POLL_INTERVAL_MS));
        }
      }

      if (!childWorkflowId) {
        await handle.terminate("temporal-test-kit H3 check: child never started").catch(() => {});
        return {
          ...base,
          status: "FAIL" as const,
          message: `${target.type} never actually started a child workflow within ${CHILD_START_TIMEOUT_MS}ms — this run can't tell you anything about cancellation propagation until it does.`,
          hint:
            "This points at a setup problem (starting the child), not at cancellation-handling behavior. Confirm " +
            `workflows[].sampleInput gives ${target.type} what it needs to reach its startChild()/executeChild() ` +
            "call in a normal run.",
        };
      }

      const childHandle = env.client.workflow.getHandle(childWorkflowId);
      const childStatusBeforeCancel = await childHandle.describe().then(
        (d) => d.status.name,
        () => "UNKNOWN",
      );

      if (childStatusBeforeCancel !== "RUNNING") {
        return {
          ...base,
          status: "FAIL" as const,
          message: `The child workflow (${childWorkflowId}) was already ${childStatusBeforeCancel}, not RUNNING, by the time this check tried to cancel its parent — it wasn't actually in flight, so this run can't tell you anything about cancellation propagation.`,
          hint:
            "H3 needs the child workflow to still be running when its parent is cancelled, to observe whether " +
            "the cancellation actually reaches it. Confirm the child stays open long enough (e.g. waiting on a " +
            "signal) for a check to act on it while it's still in flight.",
        };
      }

      await handle.cancel();

      await raceWithTimeout(handle.result().catch(() => {}), RESULT_WAIT_MS, () => undefined);

      const parentHistory = await handle.fetchHistory();
      const parentEvents = parentHistory.events ?? [];
      const parentTerminalEvent = parentEvents.find(
        (e) =>
          e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED ||
          e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED ||
          e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED ||
          e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_TERMINATED,
      );

      const childHistory = await childHandle.fetchHistory().catch(() => undefined);
      const childEvents = childHistory?.events ?? [];
      const childCancelRequested = childEvents.some(
        (e) => e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CANCEL_REQUESTED,
      );

      if (!parentTerminalEvent) {
        return {
          ...base,
          status: "FAIL" as const,
          message: `${target.type} did not reach a terminal state within ${RESULT_WAIT_MS}ms after being cancelled.`,
          hint:
            "A cancelled workflow should reach a clean terminal state once cancellation (and any child-workflow " +
            "propagation) resolves — a parent that hangs instead suggests cancellation handling around the child " +
            "workflow call doesn't propagate/resolve correctly.",
        };
      }

      if (parentTerminalEvent.eventType !== EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED) {
        return {
          ...base,
          status: "FAIL" as const,
          message: `${target.type} was cancelled but reached ${EventType[parentTerminalEvent.eventType!]} instead of WORKFLOW_EXECUTION_CANCELED (child cancellation ${childCancelRequested ? "DID" : "did NOT"} reach ${childWorkflowId}).`,
          hint:
            "A cancelled parent awaiting its child's result should reach a clean CANCELED terminal state, not " +
            "FAILED/COMPLETED/TERMINATED — reaching FAILED typically means the parent's own error handling wraps " +
            "the CancelledFailure it receives into an application failure instead of letting normal cancellation " +
            "semantics through (compare to how it should handle a genuine child business failure, which SHOULD " +
            "become an application failure — the two need to be told apart).",
        };
      }

      if (!childCancelRequested) {
        return {
          ...base,
          status: "FAIL" as const,
          message: `${target.type} reached CANCELED, but the child workflow's (${childWorkflowId}) own event history shows no WorkflowExecutionCancelRequested event — the cancellation does not appear to have actually reached the child.`,
          hint:
            "Cancelling a parent should propagate to any child workflow it started in a cancellable scope (the " +
            "SDK default) — a parent that reaches CANCELED without its child ever being notified suggests the " +
            "child call was made in a non-cancellable scope, or an explicit ChildWorkflowCancellationType.ABANDON " +
            "was set, cutting off propagation.",
        };
      }

      return {
        ...base,
        status: "PASS" as const,
        message:
          `${target.type} reached a clean CANCELED terminal state after being cancelled, and the child workflow's ` +
          `(${childWorkflowId}) own event history confirms a WorkflowExecutionCancelRequested event actually ` +
          "reached it — real evidence that cancellation propagated to the child, not just that the parent's own " +
          "execution ended. This does NOT confirm the child itself finished cancelling (the SDK allows a child to " +
          "legitimately ignore a cancellation request and complete on its own terms) — only that the request " +
          "demonstrably reached it.",
        hint: null,
      };
    }, signal);
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.type}, discover its child, and cancel the parent: ${(e as Error).message}`,
      hint:
        `This check starts ${target.type}, discovers its child workflow's real ID from event history, and calls ` +
        "handle.cancel() on the parent while the child is in flight. This failure is about setting that up, not " +
        `about cancellation-handling behavior itself — confirm workflows[].sampleInput is valid for ${target.type}.`,
    };
  }
};
