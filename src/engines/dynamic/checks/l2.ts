import proto from "@temporalio/proto";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withFaultInjectedWorker } from "../fault-injection.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "L2")!;
const EventType = proto.temporal.api.enums.v1.EventType;
const RESULT_WAIT_MS = 10_000;
const OUTAGE_MESSAGE = "temporal-test-kit L2: simulating a temporary dependency outage (retryable)";

/**
 * The attempt number at which the simulated outage "recovers" and calls
 * through to the real activity implementation. Attempts 1 and 2 are forced
 * to fail with a RETRYABLE `ApplicationFailure` (a real outage should be
 * retryable — that's the whole point, unlike G1's permanent
 * `.nonRetryable()` failure); attempt 3+ calls through to the real impl.
 *
 * 3 is not arbitrary: it's picked to fit sample-project's own
 * `chargeCardActivity`, whose `proxyActivities()` retry policy in
 * `workflows.ts` sets `maximumAttempts: 3` — exactly enough attempts to
 * reach recovery, no more. If a target activity's own configured retry
 * policy allows FEWER attempts than this, the workflow will legitimately
 * exhaust its retries and fail before ever reaching the simulated recovery
 * — see the FAIL branch below, which is a real, correctly-reported finding
 * about the target project's own retry policy, not a bug in this check.
 */
const RECOVER_AT_ATTEMPT = 3;

/**
 * L2 ("A dependency outage doesn't lose work") reuses `withFaultInjectedWorker`
 * (built for G1, also used by B3) to make `dependencyOutageTestActivity`
 * behave like a dependency that's temporarily down: it fails the first
 * `RECOVER_AT_ATTEMPT - 1` attempts with a RETRYABLE failure, then — once
 * "recovered" — calls straight through to the REAL implementation and
 * returns its real result, same call-through technique as B3's
 * `forceRetryOnce`, just conditioned on a threshold rather than "attempt 1
 * only".
 *
 * Unlike G1 (permanent failure, proving the workflow reaches a clean FAILED
 * state) and B3 (exactly one forced retry after an apparent success, proving
 * tolerance of a late/duplicate result), L2 proves a third, distinct thing:
 * that a genuinely multi-attempt, eventually-recovering failure doesn't sink
 * the workflow — it should still reach COMPLETED once the "dependency"
 * comes back, having genuinely retried through the outage rather than
 * skipping past it.
 *
 * From event history (same techniques as g1.ts/b3.ts):
 *   - `dependencyOutageTestActivity` was actually scheduled at all (same
 *     "never reached" guard every fixture check in this batch has).
 *   - It was attempted more than once (`ActivityTaskStarted.attempt` > 1
 *     reached) — proves the outage was real, not skipped over.
 *   - The workflow reached a terminal COMPLETED state — proves it
 *     recovered once the dependency came back, rather than the outage
 *     permanently sinking the whole workflow.
 *
 * A terminal FAILED state is reported as FAIL, but the message/hint
 * distinguish two different causes, same honesty standard as everywhere
 * else in this batch:
 *   (a) the max attempt reached never got past `RECOVER_AT_ATTEMPT - 1` —
 *       this means the activity's OWN configured retry policy doesn't allow
 *       enough attempts to reach recovery, so the workflow legitimately
 *       failed out before recovery was ever possible. This is a genuine,
 *       useful finding about the target project (its retry budget can't
 *       even survive this check's short simulated outage) — not a bug in
 *       this check.
 *   (b) the max attempt reached DID get to `RECOVER_AT_ATTEMPT` or beyond,
 *       but the workflow still didn't complete — this means the workflow
 *       doesn't tolerate recovery even once the dependency came back, a
 *       more direct hit on the claim this check exists to test.
 *
 * On PASS, the message is explicit that this only proves tolerance of an
 * outage that resolves within the activity's own configured retry budget —
 * it does NOT prove anything about an outage that outlasts that budget,
 * since no config field here captures how long a "real" outage should be
 * tolerated (same scope-honesty treatment as L1's connection-loss-only
 * claim and B3's "doesn't prove dedup" claim).
 */
export const checkL2DependencyOutageRecovery: DynamicFixtureCheckFn = async (env, target, _features, signal) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.dependencyOutageTestActivity)) {
    return missingFixtureResult(base, "workflows[].dependencyOutageTestActivity");
  }
  const activityName = target.dependencyOutageTestActivity as string;
  const realImpl = target.activities[activityName] as ((...args: unknown[]) => unknown) | undefined;

  if (typeof realImpl !== "function") {
    return {
      ...base,
      status: "FAIL",
      message: `${activityName} is not a real exported activity in this project's activities module.`,
      hint: `workflows[].dependencyOutageTestActivity names "${activityName}", but no function by that name is exported from this project's activities file. Confirm the name matches exactly.`,
    };
  }

  const workflowId = generateWorkflowId("L2", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  const forceOutageThenRecover = async (...activityArgs: unknown[]) => {
    if (Context.current().info.attempt < RECOVER_AT_ATTEMPT) {
      throw ApplicationFailure.retryable(OUTAGE_MESSAGE, "TTK_L2_SIMULATED_OUTAGE");
    }
    return realImpl(...activityArgs);
  };

  let events: proto.temporal.api.history.v1.IHistoryEvent[];
  try {
    const history = await withFaultInjectedWorker(env, target, activityName, forceOutageThenRecover, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });
      await raceWithTimeout(handle.result().catch(() => {}), RESULT_WAIT_MS, () => undefined);
      return handle.fetchHistory();
    }, signal);
    events = history.events ?? [];
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.type} with ${activityName} wrapped to simulate a temporary outage: ${(e as Error).message}`,
      hint:
        `This check needs to start ${target.type} against a worker with ${activityName} wrapped to fail for its ` +
        "first few attempts and then recover. This failure is about setting that up, not about outage-recovery " +
        "behavior itself.",
    };
  }

  const scheduledForThisActivity = events.some(
    (e) =>
      e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED &&
      e.activityTaskScheduledEventAttributes?.activityType?.name === activityName,
  );

  if (!scheduledForThisActivity) {
    return {
      ...base,
      status: "FAIL",
      message: `${target.type} never actually invoked ${activityName} — this run can't tell you anything about dependency-outage recovery until it does.`,
      hint:
        `${activityName} was never scheduled at all, so the simulated outage never had a chance to fire. This ` +
        `usually means the workflow failed or branched away earlier for an unrelated reason — commonly missing ` +
        `or malformed workflows[].sampleInput. Confirm sampleInput gives ${target.type} what it needs to reach ` +
        `${activityName} in a normal run.`,
    };
  }

  const startedAttempts = events
    .filter((e) => e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_STARTED)
    .map((e) => e.activityTaskStartedEventAttributes?.attempt ?? 0);
  const maxAttempt = Math.max(0, ...startedAttempts);

  if (maxAttempt < 2) {
    return {
      ...base,
      status: "FAIL",
      message: `${activityName} was only attempted once — the simulated outage never actually took effect.`,
      hint:
        "This check's own outage-simulation logic didn't force a retry, which points at a bug in " +
        "temporal-test-kit rather than a finding about this project — report this against " +
        "src/engines/dynamic/checks/l2.ts.",
    };
  }

  const terminalEvent = events.find(
    (e) =>
      e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED ||
      e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED,
  );

  if (!terminalEvent) {
    return {
      ...base,
      status: "FAIL",
      message: `${target.type} did not reach a terminal state within ${RESULT_WAIT_MS}ms after ${activityName} was forced through a simulated outage.`,
      hint:
        "A temporary dependency outage that eventually recovers should produce a clean, prompt terminal outcome " +
        "— a workflow that hangs instead of resolving means an activity's transient failures can leave the " +
        "workflow stuck rather than cleanly reported.",
    };
  }

  if (terminalEvent.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED) {
    if (maxAttempt < RECOVER_AT_ATTEMPT) {
      return {
        ...base,
        status: "FAIL",
        message:
          `${target.type} failed after only ${maxAttempt} attempt(s) of ${activityName} — its own configured ` +
          `retry policy doesn't allow enough attempts to reach this check's simulated recovery point (attempt ` +
          `${RECOVER_AT_ATTEMPT}).`,
        hint:
          `${activityName}'s retry policy (configured in this project's own proxyActivities() call) allows fewer ` +
          `attempts than needed to survive even this check's short simulated outage. This is a real finding ` +
          `about ${target.type}'s resilience, not a bug in this check: either raise ${activityName}'s ` +
          "maximumAttempts, or accept that a real outage shorter than that budget can still sink this workflow.",
      };
    }
    return {
      ...base,
      status: "FAIL",
      message: `${target.type} did not complete even though ${activityName} reached attempt ${maxAttempt} (at or past the simulated recovery point) — the workflow did not recover once the dependency came back.`,
      hint:
        `${activityName} was retried enough times to reach the point where this check's simulated outage ends ` +
        `and the real activity call succeeds, but ${target.type} still ended up FAILED. Check whether ` +
        `${target.type} does anything that treats a late-arriving activity success as an error, or whether ` +
        "something else fails permanently before the retried result can be used.",
    };
  }

  return {
    ...base,
    status: "PASS",
    message:
      `${activityName} was forced to fail through attempt ${maxAttempt >= RECOVER_AT_ATTEMPT ? RECOVER_AT_ATTEMPT - 1 : maxAttempt} (simulating a temporary dependency outage) and then allowed to recover and call through to its real implementation, and ${target.type} still reached COMPLETED. This confirms the workflow tolerates a TEMPORARY outage of ${activityName} and recovers once it stops failing — it does NOT prove behavior for an outage that exceeds ${activityName}'s own configured retry budget (that's a different, harder claim requiring this check to know how long a "real" outage should be tolerated, which no config field here captures).`,
    hint: null,
  };
};
