import proto from "@temporalio/proto";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withFaultInjectedWorker } from "../fault-injection.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";
import { sendPrimingSignals } from "../priming.js";
import { WaitBudgetsConfig } from "../../../config/schema.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "B3")!;
const EventType = proto.temporal.api.enums.v1.EventType;
const RESULT_WAIT_MS = 10_000;
const FORCED_RETRY_MESSAGE = "temporal-test-kit B3: forcing a retry after a successful attempt to test recovery";

/**
 * B3's catalog name ("Retrying a step doesn't repeat its effect") and the
 * spec's own Appendix A comment ("The tool will force it to retry and
 * confirm it doesn't happen twice") both describe a claim this tool cannot
 * actually verify from outside: whether `idempotencyTestActivity`'s REAL
 * side effect (an email sent, a charge made, a row written) happened once
 * or twice depends entirely on that activity's own internal logic (does it
 * check some dedup/idempotency key before acting?) — logic this
 * project-independent tool has no way to observe. Two DIFFERENT things can
 * be meant by "retrying doesn't repeat the effect":
 *   (a) Temporal's own server-side guarantee that exactly ONE
 *       ActivityTaskCompleted ever gets recorded for a given activity task,
 *       no matter how many attempts it took — this is ALWAYS true,
 *       regardless of the target project's code, so testing it would be an
 *       uninformative check that always passes and tells the user nothing.
 *   (b) The activity's real-world side effect wasn't duplicated across
 *       attempts — the actually useful claim B3's name implies, but not
 *       something externally observable without the activity cooperating
 *       (e.g. recording its own invocation count somewhere this tool could
 *       read, which it has no generic way to ask for).
 *
 * So this check reports against a THIRD, narrower-but-honest claim,
 * same treatment L1 got for its narrower connection-loss scope: does the
 * WORKFLOW recover correctly when `idempotencyTestActivity` is forced to be
 * reattempted after already appearing to succeed once? This is fully
 * generic (no cooperation needed) and genuinely useful — it catches real
 * bugs (e.g. a workflow that doesn't tolerate a late/duplicate activity
 * result, or a retry policy that doesn't allow a second attempt) — but it
 * is explicitly NOT proof the activity's real side effect was deduplicated,
 * and the message/hint say so on every PASS, not just on FAIL.
 *
 * How the retry is forced: `withFaultInjectedWorker` (built for G1) wraps
 * the REAL activity — unlike G1's replacement, which never calls the real
 * implementation, this one calls straight through to it (so the real
 * side effect genuinely happens), then, only on the FIRST attempt
 * (`Context.current().info.attempt === 1`), throws a RETRYABLE failure
 * anyway — simulating "the work completed but the result never made it
 * back to Temporal" (a real failure mode: a network blip after the
 * activity finished but before it could report success). No interface
 * change to `withFaultInjectedWorker` was needed for this — it already
 * accepts any replacement function, and `Context.current()` is available
 * to any function the SDK invokes as an activity regardless of how it got
 * registered.
 */
export const checkB3Idempotency: DynamicFixtureCheckFn = async (env, target, _features, signal, waitBudgets) => {
  const resultWaitMs = waitBudgets?.B3?.resultWaitMs ?? RESULT_WAIT_MS;
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.idempotencyTestActivity)) {
    return missingFixtureResult(base, "workflows[].idempotencyTestActivity");
  }
  const activityName = target.idempotencyTestActivity as string;
  const realImpl = target.activities[activityName] as ((...args: unknown[]) => unknown) | undefined;

  if (typeof realImpl !== "function") {
    return {
      ...base,
      status: "FAIL",
      message: `${activityName} is not a real exported activity in this project's activities module.`,
      hint: `workflows[].idempotencyTestActivity names "${activityName}", but no function by that name is exported from this project's activities file. Confirm the name matches exactly.`,
    };
  }

  const workflowId = generateWorkflowId("B3", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  const forceRetryOnce = async (...activityArgs: unknown[]) => {
    const result = await realImpl(...activityArgs);
    if (Context.current().info.attempt === 1) {
      throw ApplicationFailure.retryable(FORCED_RETRY_MESSAGE, "TTK_B3_FORCED_RETRY");
    }
    return result;
  };

  let events: proto.temporal.api.history.v1.IHistoryEvent[];
  try {
    const history = await withFaultInjectedWorker(env, target, activityName, forceRetryOnce, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });
      // Drive past any precondition the workflow waits on indefinitely, so the
      // named activity is actually reachable for the forced retry below.
      await sendPrimingSignals(handle, target.primingSignals);
      await raceWithTimeout(handle.result().catch(() => {}), resultWaitMs, () => undefined);
      return handle.fetchHistory();
    }, signal);
    events = history.events ?? [];
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.type} with ${activityName} wrapped to force a retry: ${(e as Error).message}`,
      hint:
        `This check needs to start ${target.type} against a worker with ${activityName} wrapped to force a ` +
        "retry after its first successful attempt. This failure is about setting that up, not about retry " +
        "behavior itself.",
    };
  }

  const startedAttempts = events
    .filter((e) => e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_STARTED)
    .map((e) => e.activityTaskStartedEventAttributes?.attempt ?? 0);

  const scheduledForThisActivity = events.some(
    (e) =>
      e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED &&
      e.activityTaskScheduledEventAttributes?.activityType?.name === activityName,
  );

  if (!scheduledForThisActivity) {
    return {
      ...base,
      status: "FAIL",
      message: `${target.type} never actually invoked ${activityName} — this run can't tell you anything about retry recovery until it does.`,
      hint:
        `${activityName} was never scheduled at all, so it never had a chance to be forced into a retry. This ` +
        `usually means the workflow failed or branched away earlier for an unrelated reason — commonly missing ` +
        `or malformed workflows[].sampleInput. Confirm sampleInput gives ${target.type} what it needs to reach ` +
        `${activityName} in a normal run.`,
    };
  }

  const maxAttempt = Math.max(0, ...startedAttempts);
  if (maxAttempt < 2) {
    return {
      ...base,
      status: "FAIL",
      message: `${activityName} was only attempted once — the forced retry never happened.`,
      hint:
        "This check's own retry-forcing logic didn't take effect, which points at a bug in temporal-test-kit " +
        `rather than a finding about ${target.type} — report this against src/engines/dynamic/checks/b3.ts.`,
    };
  }

  const terminalEvent = events.find(
    (e) =>
      e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED ||
      e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED,
  );

  if (!terminalEvent || terminalEvent.eventType !== EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED) {
    return {
      ...base,
      status: "FAIL",
      message: `${target.type} did not complete successfully after ${activityName} was forced to retry (${
        terminalEvent ? "reached a FAILED state" : "never reached a terminal state"
      }).`,
      hint:
        `A workflow should tolerate one of its activities being reattempted after an apparent (but unreported) ` +
        `success — if it doesn't, work that actually succeeded could still end up reported as a failure. Check ` +
        `${activityName}'s retry policy allows at least 2 attempts, and that ${target.type} doesn't do anything ` +
        "that breaks on a late/duplicate activity completion.",
    };
  }

  return {
    ...base,
    status: "PASS",
    message:
      `${activityName} was forced to be reattempted (attempt 2) after appearing to succeed on attempt 1, and ` +
      `${target.type} still completed normally. This confirms the workflow tolerates ${activityName} being ` +
      "retried — it does NOT confirm the activity's real-world side effect was itself deduplicated (that " +
      "depends on internal logic — e.g. an idempotency key check — this tool cannot observe from outside). If " +
      `${activityName} isn't written to be safe against being called twice, a real retry in production could ` +
      "still duplicate real work even though this check passes.",
    hint: null,
  };
};
