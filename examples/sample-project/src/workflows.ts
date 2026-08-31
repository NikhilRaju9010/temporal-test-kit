import {
  proxyActivities,
  defineSignal,
  defineQuery,
  defineUpdate,
  setHandler,
  condition,
  CancelledFailure,
  CancellationScope,
  startChild,
  ApplicationFailure,
  ChildWorkflowFailure,
  ParentClosePolicy,
  workflowInfo,
} from "@temporalio/workflow";
import type * as activities from "./activities.js";

export const updateNameSignal = defineSignal<[string]>("updateNameSignal");

const { formatGreetingActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: {
    initialInterval: "1 second",
    maximumAttempts: 3,
  },
});

export async function GreetingWorkflow(initialName: string): Promise<string> {
  let name = initialName;

  setHandler(updateNameSignal, (newName: string) => {
    name = newName;
  });

  await condition(() => true);
  return formatGreetingActivity(name);
}

// --- SagaWorkflow: fixture for G1 (saga/compensation) and K2 (sensitive data) ---
//
// A real 3-step saga (reserve → charge → ship) with real compensation: if
// the charge step fails, it releases the inventory it already reserved
// before re-throwing, rather than leaving things half-done. This exists so
// temporal-test-kit's G1 check has genuine compensation behavior to
// exercise, not just a workflow that happens to throw.
//
// G1 forces the charge step to fail via fault injection (substituting
// chargeCardActivity's implementation at the WORKER level for the check's
// own run — see fault-injection.ts) and then verifies, from the recorded
// event history: reserveInventoryActivity (before the failure point) DID
// run, shipOrderActivity (after it) did NOT run, and the workflow reached a
// clean terminal FAILED state — not stuck, not falsely reported as
// COMPLETED. releaseInventoryActivity having run is reported as
// corroborating evidence of real compensation, not the check's pass/fail
// bar itself (see G1's own file for why).
//
// `cardNumber` doubles as K2's sensitive-data-detection target via config's
// `sensitiveDataFields: ["cardNumber"]`. The value below is Stripe's own
// published test Visa number (4242 4242 4242 4242) — a standard,
// universally-recognized placeholder used across the payments industry for
// exactly this purpose, never a real card, and never charged to anything
// here. It is INTENTIONALLY left in plain text (no redacting data
// converter configured for this sample project) so K2 has a real, honest
// FAIL to report by default — this is a deliberate fixture choice for K2 to
// detect, not an oversight.
const { reserveInventoryActivity, chargeCardActivity, shipOrderActivity, releaseInventoryActivity } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "10 seconds",
    retry: {
      initialInterval: "1 second",
      maximumAttempts: 3,
    },
  });

export interface SagaOrderInput {
  orderId: string;
  cardNumber: string;
  amount: number;
}

export async function SagaWorkflow(input: SagaOrderInput): Promise<string> {
  await reserveInventoryActivity(input.orderId);
  try {
    await chargeCardActivity(input.cardNumber, input.amount);
  } catch (err) {
    await releaseInventoryActivity(input.orderId);
    throw err;
  }
  await shipOrderActivity(input.orderId);
  return `order ${input.orderId} completed`;
}

// --- InteractiveWorkflow: fixture for C1-C5 (signals/queries/updates) and H1 (cancel-runs-cleanup) ---
//
// Unlike GreetingWorkflow's `condition(() => true)` (resolves instantly —
// not a genuine wait), this workflow's `condition(() => finished)` only
// resolves once `finishSignal` arrives, so it stays open long enough for a
// check to actually signal/query/update it, and long enough to be
// cancelled with something real to observe (cleanupActivity running).
//
// State design: `pingCount`/`lastPing` are mutated by `pingSignal` — signals
// are fire-and-forget messages, not idempotent commands, so re-delivering
// the same signal is expected to apply again (pingCount increments again).
// This is a deliberate design choice documented here for C1, which sends a
// signal twice on purpose to exercise this: two applications, not
// deduplication, is the CORRECT behavior for this handler shape (a project
// that wants dedup would need its own application-level idempotency key,
// which is out of scope for this generic fixture).
//
// `changeStateUpdate` validates its input BEFORE mutating state (rejecting
// an empty/non-string name via its `validator`) — this is what gives C3 a
// real update to test: one whose rejection is enforced by the SDK before
// the handler body ever runs, not just an update that happens to accept
// everything it's given.
export interface InteractiveState {
  name: string;
  updateCount: number;
  pingCount: number;
  lastPing: string | null;
}

export const finishSignal = defineSignal("finishSignal");
export const pingSignal = defineSignal<[string]>("pingSignal");
export const getStateQuery = defineQuery<InteractiveState>("getStateQuery");
export const changeStateUpdate = defineUpdate<InteractiveState, [string]>("changeStateUpdate");

const { cleanupActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: {
    initialInterval: "1 second",
    maximumAttempts: 3,
  },
});

export async function InteractiveWorkflow(initialName: string): Promise<InteractiveState> {
  const state: InteractiveState = { name: initialName, updateCount: 0, pingCount: 0, lastPing: null };
  let finished = false;

  setHandler(finishSignal, () => {
    finished = true;
  });

  setHandler(pingSignal, (note: string) => {
    state.pingCount += 1;
    state.lastPing = note;
  });

  // Query handlers must never mutate state (C2's whole concern) — this one
  // only ever reads, and returns a shallow copy so callers can't
  // accidentally mutate the workflow's own state object through the
  // returned reference.
  setHandler(getStateQuery, () => ({ ...state }));

  setHandler(
    changeStateUpdate,
    (newName: string) => {
      state.name = newName;
      state.updateCount += 1;
      return { ...state };
    },
    {
      validator: (newName: string) => {
        if (typeof newName !== "string" || newName.trim().length === 0) {
          throw new Error("changeStateUpdate rejected: name must be a non-empty string");
        }
      },
    },
  );

  try {
    await condition(() => finished);
  } catch (err) {
    if (err instanceof CancelledFailure) {
      // The activity call below must run in a NON-cancellable scope: once
      // the workflow's root scope is cancelled (which is what got us into
      // this catch block), any activity call made in the ordinary,
      // cancellation-inheriting scope would itself be immediately
      // cancelled before ever reaching the server — cleanup would never
      // actually be scheduled, let alone run. This is the standard
      // Temporal cleanup-on-cancel pattern, not optional ceremony; H1
      // verifies this by checking real event history for a scheduled
      // activity, so a cleanup call that silently never fires (the bug
      // this scope prevents) would show up there as a real FAIL.
      await CancellationScope.nonCancellable(() =>
        cleanupActivity(`InteractiveWorkflow(${initialName}) cancelled`),
      );
    }
    throw err;
  }

  return state;
}

// --- ParentWorkflow / ChildWorkflow: fixture for F1 (failing child handled),
// F2 (child not orphaned), and H3 (cancelling a parent handles its children) ---
//
// ChildWorkflow calls one real activity (`childTaskActivity`) first — this
// is F1's fault-injection target, exactly like SagaWorkflow's
// chargeCardActivity is G1's — then waits on `childFinishSignal` (bounded to
// a generous but real timeout, not forever, so an unsent signal can't hang a
// test run indefinitely). That second phase is what gives F2/H3 a genuinely
// IN-FLIGHT child to act on: without it, the child would complete and close
// before a check calling terminate()/cancel() on the parent ever got a
// chance to observe it running.
//
// ParentWorkflow starts ChildWorkflow as a real child execution and reacts
// to it for real, modeled on SagaWorkflow's own try/catch rather than a bare
// pass-through:
//   - a genuine child FAILURE (the child's own business logic failing, e.g.
//     childTaskActivity forced to fail by F1) is converted into the
//     PARENT's own ApplicationFailure — it does not swallow the failure
//     silently, and it does not just crash the workflow task by rethrowing
//     an SDK-internal error type.
//   - a CancelledFailure reaching this same await (which is what happens
//     when the PARENT itself is cancelled — see below) is deliberately
//     RE-THROWN AS-IS — either directly, or unwrapped from the
//     ChildWorkflowFailure the SDK sometimes wraps it in depending on
//     exactly when in the child's lifecycle the cancellation lands — never
//     wrapped into this workflow's own ApplicationFailure, so the parent
//     reaches Temporal's normal CANCELED terminal state rather than being
//     misreported as FAILED. This is the same "don't paper over
//     CancelledFailure" discipline as InteractiveWorkflow's
//     cleanup-on-cancel handling above.
//
// `parentClosePolicy` is a real, caller-controlled parameter (not a config
// guess) — it's Temporal's own mechanism for what happens to a still-running
// child when the PARENT reaches a Closed state via something other than an
// in-workflow await (most concretely: the parent being terminated out from
// under it, which bypasses workflow code entirely). F2 exercises this
// directly. It is UNRELATED to how an explicit `handle.cancel()` on the
// parent propagates to the child — that is governed by
// `ChildWorkflowCancellationType` on the `startChild` call instead (left at
// its SDK default, `WAIT_CANCELLATION_COMPLETED`, which always propagates a
// parent's own cancellation down to the child) — which is what H3 exercises.
// See h3.ts for why this means H3 doesn't need an "ABANDON-honesty" branch
// the way F2 does.
//
// The child's workflow ID is deliberately DERIVED from the parent's own
// workflow ID (`${parentWorkflowId}-child`) rather than taken as a literal
// from config/sampleInput: this workflow is started by many different
// checks against one shared environment (zero-fixture checks run it too,
// via A1/A3/etc., same as every other fixture'd workflow type), each with
// its own unique parent ID from `generateWorkflowId` — a hardcoded child ID
// in sampleInput would collide across those runs ("workflow already
// started"). Deriving it from the parent's own ID keeps it just as unique,
// and lets a check that generated the parent's ID compute the child's ID
// the same way, without this workflow needing to report it back explicitly.
export interface ParentWorkflowInput {
  childTaskId: string;
  parentClosePolicy?: "TERMINATE" | "ABANDON" | "REQUEST_CANCEL";
}

const { childTaskActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: {
    initialInterval: "1 second",
    maximumAttempts: 3,
  },
});

export const childFinishSignal = defineSignal("childFinishSignal");

export interface ChildWorkflowInput {
  taskId: string;
}

export async function ChildWorkflow(input: ChildWorkflowInput): Promise<string> {
  const result = await childTaskActivity(input.taskId);

  let finished = false;
  setHandler(childFinishSignal, () => {
    finished = true;
  });
  // Bounded wait, not `condition(() => finished)` alone: this keeps the
  // child genuinely in-flight for F2/H3 to act on, while guaranteeing a
  // worker/environment left running with nothing sending the signal doesn't
  // hang forever.
  await condition(() => finished, "2 minutes");

  return result;
}

export async function ParentWorkflow(input: ParentWorkflowInput): Promise<string> {
  const childWorkflowId = `${workflowInfo().workflowId}-child`;
  const handle = await startChild(ChildWorkflow, {
    workflowId: childWorkflowId,
    args: [{ taskId: input.childTaskId }],
    parentClosePolicy: ParentClosePolicy[input.parentClosePolicy ?? "TERMINATE"],
  });

  try {
    const result = await handle.result();
    return `ParentWorkflow: child ${childWorkflowId} completed with result: ${result}`;
  } catch (err) {
    // The parent itself being cancelled (as opposed to the child failing on
    // its own) can reach here as a bare CancelledFailure OR as a
    // ChildWorkflowFailure whose `cause` is one — which shape shows up
    // depends on exactly when in the child's lifecycle the cancellation
    // lands. Either way, this is cancellation, not a business failure: let
    // normal cancellation semantics propagate (throwing the CancelledFailure
    // itself, not this catch's own ApplicationFailure) so the workflow
    // reaches Temporal's real CANCELED terminal state — never misreported
    // as FAILED.
    if (err instanceof CancelledFailure) {
      throw err;
    }
    if (err instanceof ChildWorkflowFailure && err.cause instanceof CancelledFailure) {
      throw err.cause;
    }
    const cause =
      err instanceof ChildWorkflowFailure && err.cause instanceof Error ? err.cause.message : (err as Error).message;
    throw ApplicationFailure.nonRetryable(
      `ParentWorkflow: child workflow ${childWorkflowId} failed: ${cause}`,
      "TTK_CHILD_WORKFLOW_FAILED",
    );
  }
}
