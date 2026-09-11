import proto from "@temporalio/proto";

const EventType = proto.temporal.api.enums.v1.EventType;

/** Matches V8's error messages for accessing a property of, or destructuring,
 * a null/undefined value — the signature you get when a workflow function
 * expects a required argument and none was supplied. Case-insensitive, and
 * covers every real V8 shape this project verified empirically (Node
 * `node -e` repro), since workflow authors reach a required argument in one
 * of two idiomatic ways and each produces different wording:
 *   - direct/statement property access — "Cannot read propert(y|ies) ...
 *     of (null|undefined)" (e.g. `input.agentRetry` when `input` is
 *     undefined: "Cannot read properties of undefined (reading
 *     'agentRetry')" — confirmed against this exact real-world crash).
 *   - destructuring, either a parameter (`function f({ foo })`) or a local
 *     (`const { foo } = input`) — "Cannot destructure property '...' of
 *     '...' as it is (null|undefined)" (verified for both parameter and
 *     local destructuring; only the quoted source-expression name differs
 *     between them, not the surrounding wording this pattern matches). */
const MISSING_ARG_MESSAGE_PATTERN =
  /cannot read propert(y|ies)( '[^']*')? of (null|undefined)|cannot destructure propert(y|ies) '[^']*' of '[^']*' as it is (null|undefined)/i;

export interface MissingInputSuspicion {
  /**
   * True only when EVERY workflow task attempt so far has failed (zero
   * WorkflowTaskCompleted ever recorded) AND the first such failure's
   * message matches the "property of null/undefined" JS TypeError shape.
   *
   * Deliberately narrow: a workflow can fail its first task for reasons
   * that have nothing to do with missing input (a real, unrelated bug that
   * crashes unconditionally on ANY input looks structurally identical —
   * same zero-completed-tasks, same forever-retried-failure shape). This
   * only distinguishes the ERROR SHAPE that specifically indicates "some
   * value was undefined/null where a property was accessed on it" — it
   * does not and cannot prove the missing value was the caller's supplied
   * argument. Callers should surface `failureMessage` alongside any
   * suspicion so a human can verify it wasn't a false positive, never
   * silently reclassify a result on this alone.
   */
  suspected: boolean;
  /** The first matching (or first, if none match) WorkflowTaskFailed message, for display. */
  failureMessage?: string;
}

/**
 * Zero-fixture checks (A1, B5) start a workflow with no arguments, since
 * there's no `workflows[].sampleInput` to pass. A workflow that requires a
 * real argument and destructures/accesses it immediately throws
 * synchronously on its very first workflow task — and Temporal retries a
 * failed WORKFLOW TASK forever rather than failing the WORKFLOW EXECUTION,
 * so from `describe()` alone this is indistinguishable from a genuine hang:
 * both just report RUNNING forever. This inspects the actual event history
 * to tell those apart well enough to word the result honestly, without
 * ever asserting more certainty than the evidence supports.
 */
export function detectPossibleMissingInputCrash(
  events: proto.temporal.api.history.v1.IHistoryEvent[],
): MissingInputSuspicion {
  const everCompleted = events.some((e) => e.eventType === EventType.EVENT_TYPE_WORKFLOW_TASK_COMPLETED);
  if (everCompleted) return { suspected: false };

  const failures = events.filter((e) => e.eventType === EventType.EVENT_TYPE_WORKFLOW_TASK_FAILED);
  if (failures.length === 0) return { suspected: false };

  const firstMessage = failures[0].workflowTaskFailedEventAttributes?.failure?.message ?? undefined;
  const suspected = typeof firstMessage === "string" && MISSING_ARG_MESSAGE_PATTERN.test(firstMessage);
  return { suspected, failureMessage: firstMessage };
}
