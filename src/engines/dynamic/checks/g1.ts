import proto from "@temporalio/proto";
import { ApplicationFailure } from "@temporalio/common";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withFaultInjectedWorker } from "../fault-injection.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "G1")!;
const EventType = proto.temporal.api.enums.v1.EventType;
const RESULT_WAIT_MS = 10_000;
const INJECTED_FAILURE_MESSAGE = "temporal-test-kit G1: forced failure to test saga/compensation behavior";

/**
 * G1 forces `workflows[].sagaFailurePoint` to fail (via `withFaultInjectedWorker`
 * — the project's real activities run unchanged except this one) and checks
 * the ONE thing that's fully, generically provable without knowing anything
 * about the project's business logic: does the workflow reach a clean
 * terminal FAILED state, rather than either (a) silently reporting
 * COMPLETED anyway — the failure got swallowed — or (b) hanging forever?
 *
 * Earlier design (in the Phase 3 plan) also wanted to positively confirm
 * "no forward-progress activity ran after the failure point" as part of the
 * pass/fail bar. Building it surfaced why that's wrong: an activity
 * scheduled AFTER the failure point could just as easily be real
 * compensation (a rollback step, exactly the GOOD behavior this check
 * exists to reward) as it could be an erroneous forward step — and this
 * tool has no config field naming which compensating activities belong to
 * which saga, so it can't tell those apart. Sample-project's own
 * SagaWorkflow calls `releaseInventoryActivity` (compensation) right after
 * the failure; a naive "nothing scheduled after the failure point" bar
 * would have flagged that CORRECT behavior as a false FAIL. So this check
 * reports what happens after the failure point only as informational
 * context in the PASS message, never as a pass/fail signal.
 */
export const checkG1SagaCompensation: DynamicFixtureCheckFn = async (env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.sagaFailurePoint)) {
    return missingFixtureResult(base, "workflows[].sagaFailurePoint");
  }
  const failurePoint = target.sagaFailurePoint as string;

  const workflowId = generateWorkflowId("G1", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  let events: proto.temporal.api.history.v1.IHistoryEvent[];
  try {
    const history = await withFaultInjectedWorker(
      env,
      target,
      failurePoint,
      async () => {
        throw ApplicationFailure.nonRetryable(INJECTED_FAILURE_MESSAGE, "TTK_G1_INJECTED_FAILURE");
      },
      async () => {
        const handle = await env.client.workflow.start(target.type, {
          taskQueue: target.taskQueue,
          workflowId,
          args,
        });
        await Promise.race([
          handle.result().catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, RESULT_WAIT_MS)),
        ]);
        return handle.fetchHistory();
      },
    );
    events = history.events ?? [];
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.type} with ${failurePoint} fault-injected to fail: ${(e as Error).message}`,
      hint:
        `This check needs to start ${target.type} against a worker with ${failurePoint} replaced by a forced ` +
        "failure. This failure is about setting that up, not about saga behavior itself — confirm " +
        `${failurePoint} is a real exported activity in this project's activities module.`,
    };
  }

  const scheduledActivityEvents = events.filter(
    (e) => e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED,
  );
  const failurePointIndex = scheduledActivityEvents.findIndex(
    (e) => e.activityTaskScheduledEventAttributes?.activityType?.name === failurePoint,
  );

  if (failurePointIndex === -1) {
    return {
      ...base,
      status: "FAIL",
      message: `${target.type} never actually invoked ${failurePoint} — this run can't tell you anything about saga/compensation behavior until it does.`,
      hint:
        `${failurePoint} was never scheduled at all, so the injected failure never had a chance to fire. This ` +
        `usually means the workflow failed or branched away earlier for an unrelated reason — commonly missing ` +
        `or malformed workflows[].sampleInput. Confirm sampleInput gives ${target.type} what it needs to reach ` +
        `${failurePoint} in a normal run.`,
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
      message: `${target.type} did not reach a terminal state within ${RESULT_WAIT_MS}ms after ${failurePoint} was forced to fail.`,
      hint:
        "A mid-saga failure should produce a clean, prompt terminal outcome (typically FAILED) — a workflow " +
        "that hangs instead of resolving means a mid-process failure can leave the workflow stuck rather than " +
        "cleanly reported.",
    };
  }

  if (terminalEvent.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED) {
    return {
      ...base,
      status: "FAIL",
      message: `${target.type} reported COMPLETED even though ${failurePoint} was forced to fail — the failure was silently swallowed.`,
      hint:
        "A step failing partway through a multi-step process should surface as a real workflow failure, not a " +
        "false success — otherwise a genuine mid-process failure in production could go completely unnoticed, " +
        "leaving things half-done while everything LOOKS fine.",
    };
  }

  const followUpActivities = [
    ...new Set(
      scheduledActivityEvents
        .slice(failurePointIndex + 1)
        .map((e) => e.activityTaskScheduledEventAttributes?.activityType?.name)
        .filter((name): name is string => !!name),
    ),
  ];

  const compensationNote =
    followUpActivities.length > 0
      ? ` History also shows ${followUpActivities.join(", ")} invoked after the failure — consistent with ` +
        "compensation/cleanup logic if this saga implements it (this check reports this as context, not as " +
        "part of its pass/fail bar — it has no way to know which activities are meant to compensate for which " +
        "step)."
      : "";

  return {
    ...base,
    status: "PASS",
    message:
      `Forced ${failurePoint} to fail mid-saga and confirmed ${target.type} reached a clean terminal FAILED ` +
      "state — not silently reported as COMPLETED, not stuck." +
      compensationNote,
    hint: null,
  };
};
