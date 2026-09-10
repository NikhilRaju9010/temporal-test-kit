import { ApplicationFailure } from "@temporalio/common";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { withFaultInjectedWorker } from "../fault-injection.js";
import { generateWorkflowId } from "../workflow-id.js";
import { EventType, findChildWorkflowId, HistoryEvent } from "../child-workflow-events.js";
import { raceWithTimeout } from "../race.js";
import { WaitBudgetsConfig } from "../../../config/schema.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "F1")!;
const DISCOVERY_POLL_INTERVAL_MS = 200;
const DISCOVERY_TIMEOUT_MS = 6_000;
const RESULT_WAIT_MS = 10_000;
const INJECTED_FAILURE_MESSAGE = "temporal-test-kit F1: forced failure to test failing-child-workflow handling";

/**
 * `hasChildWorkflows` is a boolean where `false` is a real value, so this
 * checks `!== true` explicitly, same reasoning as E2's isLongRunning.
 * N_A gating on `features.childWorkflows` happens in the orchestrator.
 *
 * Unlike G1 (which fault-injects a named activity via a dedicated config
 * field, `workflows[].sagaFailurePoint`), there is no config field naming
 * WHICH activity the child workflow calls — the schema only asks for
 * `hasChildWorkflows: true`. Hardcoding an activity name here would only
 * ever work against this one sample project, defeating the whole point of
 * a project-independent tool. So this check runs in two phases:
 *
 *   1. A normal (non-faulted) run of `target.type`, purely to observe,
 *      generically, from real event history — never guessed — which
 *      activity its child workflow actually invokes: first the PARENT's
 *      own history for a `ChildWorkflowExecutionStarted` event (which
 *      names the child's real workflow ID, assigned by Temporal itself,
 *      not any naming convention this tool assumes — see
 *      `child-workflow-events.ts`), then the CHILD's own history for its
 *      first `ActivityTaskScheduled` event. The probe run is terminated
 *      once discovery succeeds (or times out) so it doesn't leak.
 *   2. `withFaultInjectedWorker` (same technique as G1) replaces that
 *      discovered activity with a forced failure, runs `target.type` again
 *      for real, and checks the ONE thing that's fully, generically
 *      provable without knowing anything about this project's business
 *      logic: does the PARENT reach a clean terminal FAILED state — not
 *      silently COMPLETED (the child's failure got swallowed), not stuck?
 *      This is exactly G1's own pass/fail bar, adapted from "a step in a
 *      saga fails" to "a child workflow fails" — see g1.ts's doc comment
 *      for why a narrower, evidence-based bar like this (rather than also
 *      asserting something about what compensating/cleanup logic the
 *      parent runs afterward) is the honest choice: this tool has no way
 *      to know what a correct reaction beyond "don't swallow it" looks
 *      like for an arbitrary project.
 */
export const checkF1FailingChildHandled: DynamicFixtureCheckFn = async (env, target, _features, signal, waitBudgets) => {
  const resultWaitMs = waitBudgets?.F1?.resultWaitMs ?? RESULT_WAIT_MS;
  const discoveryTimeoutMs = waitBudgets?.F1?.discoveryTimeoutMs ?? DISCOVERY_TIMEOUT_MS;
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

  let discoveredActivityName: string | undefined;
  try {
    discoveredActivityName = await withRunningWorker(env, target, async () => {
      const probeWorkflowId = generateWorkflowId("F1-probe", target.type);
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId: probeWorkflowId,
        args,
      });

      try {
        const parentDeadline = Date.now() + discoveryTimeoutMs;
        let childWorkflowId: string | undefined;
        while (Date.now() < parentDeadline && !childWorkflowId) {
          const parentHistory = await handle.fetchHistory();
          childWorkflowId = findChildWorkflowId(parentHistory.events ?? []);
          if (!childWorkflowId) {
            await new Promise((resolve) => setTimeout(resolve, DISCOVERY_POLL_INTERVAL_MS));
          }
        }
        if (!childWorkflowId) return undefined;

        const childHandle = env.client.workflow.getHandle(childWorkflowId);
        const childDeadline = Date.now() + discoveryTimeoutMs;
        while (Date.now() < childDeadline) {
          const childHistory = await childHandle.fetchHistory().catch(() => undefined);
          const scheduled = (childHistory?.events ?? []).find(
            (e) => e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED,
          );
          const name = scheduled?.activityTaskScheduledEventAttributes?.activityType?.name;
          if (name) return name;
          await new Promise((resolve) => setTimeout(resolve, DISCOVERY_POLL_INTERVAL_MS));
        }
        return undefined;
      } finally {
        // Best-effort cleanup: this probe run's only purpose was
        // discovering the activity name, not producing a real result.
        await handle.terminate("temporal-test-kit F1 check: discovery probe complete").catch(() => {});
      }
    }, signal);
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.type} to discover which activity its child workflow invokes: ${(e as Error).message}`,
      hint:
        `This check first runs ${target.type} normally to observe (generically, from real event history) which ` +
        "activity its child workflow calls — this failure is about that setup step, not about failure-handling " +
        `behavior itself. Confirm workflows[].sampleInput is valid for ${target.type}.`,
    };
  }

  if (!discoveredActivityName) {
    return {
      ...base,
      status: "FAIL",
      message:
        `${target.type}'s child workflow never scheduled any activity within ${discoveryTimeoutMs}ms in a ` +
        "normal run — this check has no activity to fault-inject, so it can't tell you anything about " +
        "failing-child-workflow handling.",
      hint:
        `F1 needs the child workflow started by ${target.type} to invoke at least one real activity so it has ` +
        "something to force into failure. Confirm the child workflow calls an activity, and that " +
        `workflows[].sampleInput gives ${target.type} what it needs to start that child and reach it.`,
    };
  }

  const workflowId = generateWorkflowId("F1", target.type);
  let events: HistoryEvent[];
  try {
    const history = await withFaultInjectedWorker(
      env,
      target,
      discoveredActivityName,
      async () => {
        throw ApplicationFailure.nonRetryable(INJECTED_FAILURE_MESSAGE, "TTK_F1_INJECTED_FAILURE");
      },
      async () => {
        const handle = await env.client.workflow.start(target.type, {
          taskQueue: target.taskQueue,
          workflowId,
          args,
        });
        await raceWithTimeout(handle.result().catch(() => {}), resultWaitMs, () => undefined);
        return handle.fetchHistory();
      },
      signal,
    );
    events = history.events ?? [];
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.type} with its child's ${discoveredActivityName} fault-injected to fail: ${(e as Error).message}`,
      hint:
        `This check needs to start ${target.type} against a worker with ${discoveredActivityName} (an activity ` +
        "its child workflow calls) replaced by a forced failure. This failure is about setting that up, not " +
        "about failing-child-workflow handling itself.",
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
      message: `${target.type} did not reach a terminal state within ${resultWaitMs}ms after its child's ${discoveredActivityName} was forced to fail.`,
      hint:
        "A child workflow failing should produce a clean, prompt terminal outcome on the parent (typically " +
        "FAILED) — a parent that hangs instead of resolving means a failing child can leave the parent stuck " +
        "rather than cleanly reported.",
    };
  }

  if (terminalEvent.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED) {
    return {
      ...base,
      status: "FAIL",
      message: `${target.type} reported COMPLETED even though its child's ${discoveredActivityName} was forced to fail — the child's failure was silently swallowed.`,
      hint:
        "A child workflow failing partway through should surface as a real parent-workflow failure, not a false " +
        "success — otherwise a genuine child failure in production could go completely unnoticed, leaving " +
        "things half-done while everything LOOKS fine. If this parent intentionally compensates for a failing " +
        "child and completes normally afterward, that's a different, deliberate design this check can't " +
        "distinguish from a swallowed failure using only generic event history — same limitation G1 documents " +
        "for saga compensation.",
    };
  }

  return {
    ...base,
    status: "PASS",
    message:
      `Discovered that ${target.type}'s child workflow calls ${discoveredActivityName}, forced it to fail, and ` +
      `confirmed ${target.type} reached a clean terminal FAILED state — not silently reported as COMPLETED, not ` +
      "stuck. This check only confirms the failure wasn't swallowed or left the parent hanging; it does not " +
      "evaluate whether the parent's specific reaction to the failure (e.g. any cleanup it ran before failing) " +
      "is the RIGHT one for this project's business logic.",
    hint: null,
  };
};
