import proto from "@temporalio/proto";
import { WithStartWorkflowOperation, WorkflowIdConflictPolicy } from "@temporalio/client";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "C4")!;
const EventType = proto.temporal.api.enums.v1.EventType;

/**
 * C4 uses `WorkflowClient.executeUpdateWithStart` (the installed
 * `@temporalio/client` v1.23's real Update-with-Start API surface — checked
 * against its own `.d.ts` rather than guessed) TWICE against the SAME
 * workflow ID, each call wrapped in its own `WithStartWorkflowOperation`
 * (each one is single-use — the SDK throws if you try to reuse one across
 * two calls) with `workflowIdConflictPolicy: 'USE_EXISTING'`, so the second
 * call is expected to land on the SAME running execution rather than start
 * a second one. It then fetches that execution's event history and counts
 * `WorkflowExecutionStarted` events — the ONE thing this check can verify
 * fully generically: exactly one, not two, proving Update-with-Start didn't
 * create a duplicate execution.
 */
export const checkC4UpdateWithStart: DynamicFixtureCheckFn = async (env, target, _features, signal) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.updates)) {
    return missingFixtureResult(base, "workflows[].updates");
  }
  const update = target.updates![0];

  const workflowId = generateWorkflowId("C4", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  try {
    return await withRunningWorker(env, target, async () => {
      const startOptions = {
        taskQueue: target.taskQueue,
        workflowId,
        args,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      };

      const firstOp = new WithStartWorkflowOperation(target.type, startOptions);
      await env.client.workflow.executeUpdateWithStart(update.name, {
        args: [update.validInput],
        startWorkflowOperation: firstOp,
      });
      const handle = await firstOp.workflowHandle();

      const secondOp = new WithStartWorkflowOperation(target.type, startOptions);
      await env.client.workflow.executeUpdateWithStart(update.name, {
        args: [update.validInput],
        startWorkflowOperation: secondOp,
      });
      await secondOp.workflowHandle();

      try {
        const history = await handle.fetchHistory();
        const startedCount = (history.events ?? []).filter(
          (e) => e.eventType === EventType.EVENT_TYPE_WORKFLOW_EXECUTION_STARTED,
        ).length;

        if (startedCount !== 1) {
          return {
            ...base,
            status: "FAIL" as const,
            message: `Calling Update-with-Start twice with the same workflow ID ("${workflowId}") resulted in ${startedCount} WorkflowExecutionStarted events, expected exactly 1.`,
            hint:
              "Update-with-Start with workflowIdConflictPolicy USE_EXISTING should route the second call's " +
              "Update to the already-running execution, not start a second one. Multiple started events for " +
              "the same ID means duplicate work could run for what looks like one logical request.",
          };
        }

        return {
          ...base,
          status: "PASS" as const,
          message: `Calling Update-with-Start ("${update.name}") twice against the same workflow ID resulted in exactly one WorkflowExecutionStarted event — no duplicate execution.`,
          hint: null,
        };
      } finally {
        await handle.cancel().catch(() => {});
      }
    }, signal);
  } catch (e) {
    return {
      ...base,
      status: "FAIL" as const,
      message: `Could not exercise ${target.type} via Update-with-Start ("${update.name}"): ${(e as Error).message}`,
      hint:
        `This check calls WorkflowClient.executeUpdateWithStart twice against the same workflow ID for ` +
        `${target.type}'s "${update.name}" update. This failure is about setting that up, not about ` +
        `Update-with-Start behavior itself — confirm "${update.name}" matches a real setHandler() registration ` +
        `in ${target.type}, workflows[].sampleInput is valid for it, and validInput is genuinely accepted by ` +
        "its validator.",
    };
  }
};
