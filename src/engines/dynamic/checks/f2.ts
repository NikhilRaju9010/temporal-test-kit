import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { findChildWorkflowId } from "../child-workflow-events.js";
import { WaitBudgetsConfig } from "../../../config/schema.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "F2")!;
const CHILD_START_TIMEOUT_MS = 6_000;
const CHILD_START_POLL_INTERVAL_MS = 200;
const POLICY_SETTLE_TIMEOUT_MS = 8_000;
const POLICY_SETTLE_POLL_INTERVAL_MS = 300;

/**
 * `hasChildWorkflows` is a boolean where `false` is a real value, so this
 * checks `!== true` explicitly, same reasoning as F1/H1.
 *
 * F2 is specifically about `ParentClosePolicy` — Temporal's own mechanism
 * for what happens to a still-running child when its PARENT reaches a
 * Closed state via something other than an in-workflow await (most
 * concretely: the parent being terminated out from under it, which
 * bypasses workflow code entirely, so no in-workflow cleanup/cancellation
 * logic gets a chance to run — the server itself must apply the policy).
 * There is no dedicated config field for which policy value to exercise
 * (unlike G1's `sagaFailurePoint`); this check reads it from whatever
 * `workflows[].sampleInput` the project's fixture already carries (a
 * `parentClosePolicy` property, if present — sample-project's
 * `ParentWorkflow` accepts exactly this), defaulting to the SDK's own
 * default (`TERMINATE`) when absent or unrecognized. Whichever value that
 * resolves to is named explicitly in every message this check produces —
 * it cannot generically test all three values without a dedicated config
 * field naming each one, so it only ever proves ONE of them actually took
 * effect on a real child execution.
 *
 * Mechanics: start the parent, discover the child's real workflow ID from
 * the PARENT's own event history (`ChildWorkflowExecutionStarted` — never
 * guessed, see `child-workflow-events.ts`), terminate the PARENT while the
 * child is still genuinely in flight (ChildWorkflow deliberately waits on
 * a signal after its activity — see workflows.ts — specifically so there's
 * something real to terminate the parent out from under), then poll the
 * CHILD's own `describe().status` to see what actually happened to it —
 * not the parent's claim, not a guess, the child's own recorded execution
 * status.
 *
 * The pass/fail bar itself is conditional on the resolved policy, because
 * "TERMINATE"/"REQUEST_CANCEL" and "ABANDON" have OPPOSITE correct
 * outcomes: for TERMINATE/REQUEST_CANCEL, a child left RUNNING after its
 * parent closes IS the orphaning bug F2's catalog name describes. For
 * ABANDON, a child left RUNNING is the CORRECT, intended behavior — ABANDON
 * literally means "leave the child alone" — so treating that as a failure
 * would be exactly the false-flag mistake G1's own doc comment warns
 * against (flagging correct, policy-intended behavior as a bug).
 */
export const checkF2ChildNotOrphaned: DynamicFixtureCheckFn = async (env, target, _features, signal, waitBudgets) => {
  const policySettleTimeoutMs = waitBudgets?.F2?.policySettleTimeoutMs ?? POLICY_SETTLE_TIMEOUT_MS;
  const childStartTimeoutMs = waitBudgets?.F2?.childStartTimeoutMs ?? CHILD_START_TIMEOUT_MS;
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

  const sampleInputObj =
    target.sampleInput && typeof target.sampleInput === "object" ? (target.sampleInput as Record<string, unknown>) : {};
  const rawPolicy = sampleInputObj.parentClosePolicy;
  const policy = rawPolicy === "ABANDON" || rawPolicy === "REQUEST_CANCEL" || rawPolicy === "TERMINATE" ? rawPolicy : "TERMINATE";
  const policySource =
    rawPolicy === policy
      ? `as configured in workflows[].sampleInput.parentClosePolicy`
      : `the SDK's own default, since workflows[].sampleInput.parentClosePolicy is unset or not one of TERMINATE/ABANDON/REQUEST_CANCEL`;

  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];
  const workflowId = generateWorkflowId("F2", target.type);

  try {
    return await withRunningWorker(env, target, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });

      let childWorkflowId: string | undefined;
      const discoverDeadline = Date.now() + childStartTimeoutMs;
      while (Date.now() < discoverDeadline && !childWorkflowId) {
        const history = await handle.fetchHistory();
        childWorkflowId = findChildWorkflowId(history.events ?? []);
        if (!childWorkflowId) {
          await new Promise((resolve) => setTimeout(resolve, CHILD_START_POLL_INTERVAL_MS));
        }
      }

      if (!childWorkflowId) {
        await handle.terminate("temporal-test-kit F2 check: child never started").catch(() => {});
        return {
          ...base,
          status: "FAIL" as const,
          message: `${target.type} never actually started a child workflow within ${childStartTimeoutMs}ms — this run can't tell you anything about ParentClosePolicy until it does.`,
          hint:
            "This points at a setup problem (starting the child), not at orphaning behavior. Confirm " +
            `workflows[].sampleInput gives ${target.type} what it needs to reach its startChild()/executeChild() ` +
            "call in a normal run.",
        };
      }

      const childHandle = env.client.workflow.getHandle(childWorkflowId);
      const childStatusBeforeTerminate = await childHandle.describe().then(
        (d) => d.status.name,
        () => "UNKNOWN",
      );

      if (childStatusBeforeTerminate !== "RUNNING") {
        return {
          ...base,
          status: "FAIL" as const,
          message: `The child workflow (${childWorkflowId}) was already ${childStatusBeforeTerminate}, not RUNNING, by the time this check tried to terminate its parent — it wasn't actually in flight, so this run can't tell you anything about ParentClosePolicy.`,
          hint:
            "F2 needs the child workflow to still be running when its parent closes, to observe what the " +
            "configured ParentClosePolicy actually does to it. Confirm the child (ChildWorkflow in sample-project) " +
            "stays open long enough (e.g. waiting on a signal) for a check to act on it while it's still in flight.",
        };
      }

      await handle.terminate(`temporal-test-kit F2 check: terminating parent to exercise ParentClosePolicy=${policy}`);

      let childStatusAfter = "RUNNING";
      const settleDeadline = Date.now() + policySettleTimeoutMs;
      while (Date.now() < settleDeadline) {
        childStatusAfter = await childHandle.describe().then(
          (d) => d.status.name,
          () => "UNKNOWN",
        );
        if (childStatusAfter !== "RUNNING") break;
        await new Promise((resolve) => setTimeout(resolve, POLICY_SETTLE_POLL_INTERVAL_MS));
      }

      if (policy === "ABANDON") {
        if (childStatusAfter === "RUNNING") {
          return {
            ...base,
            status: "PASS" as const,
            message:
              `This check exercised ParentClosePolicy=ABANDON (${policySource}): terminated the parent while its ` +
              `child (${childWorkflowId}) was genuinely RUNNING, and confirmed the child was left running ` +
              "afterward — the correct, intended behavior for ABANDON (it means \"don't touch the child\"), not " +
              "an orphaning bug. This does NOT confirm TERMINATE/REQUEST_CANCEL behave correctly — this run only " +
              "exercised the single policy value present in this project's fixture.",
            hint: null,
          };
        }
        return {
          ...base,
          status: "FAIL" as const,
          message: `This check exercised ParentClosePolicy=ABANDON (${policySource}), but the child (${childWorkflowId}) ended up ${childStatusAfter} instead of staying RUNNING after its parent was terminated.`,
          hint:
            "ABANDON should leave the child's execution completely untouched by the parent's closure — a child " +
            "that stops running anyway (for a reason other than its own normal completion) suggests either the " +
            "policy wasn't actually applied as ABANDON, or something else is interfering with the child.",
        };
      }

      // TERMINATE / REQUEST_CANCEL: the child should NOT still be running.
      if (childStatusAfter === "RUNNING") {
        return {
          ...base,
          status: "FAIL" as const,
          message: `This check exercised ParentClosePolicy=${policy} (${policySource}): terminated the parent while its child (${childWorkflowId}) was genuinely RUNNING, and after waiting ${policySettleTimeoutMs}ms the child was STILL RUNNING — it was orphaned instead of being ${policy === "TERMINATE" ? "terminated" : "cancelled"} along with its parent.`,
          hint:
            `A child left running with no parent to ever collect its result is exactly the orphaning this check ` +
            `exists to catch. Confirm the child was actually started with parentClosePolicy: "${policy}" passed ` +
            "through to startChild()/executeChild(), and that nothing in the child's own code is written to " +
            "ignore termination/cancellation from the server.",
        };
      }

      return {
        ...base,
        status: "PASS" as const,
        message:
          `This check exercised ParentClosePolicy=${policy} (${policySource}): terminated the parent while its ` +
          `child (${childWorkflowId}) was genuinely RUNNING, and confirmed the child's own execution status ` +
          `changed to ${childStatusAfter} (no longer RUNNING) as a result — it was not left orphaned. This does ` +
          `NOT confirm the OTHER two ParentClosePolicy values behave correctly — this run only exercised the ` +
          "single policy value present in this project's fixture.",
        hint: null,
      };
    }, signal);
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.type}, discover its child, and terminate the parent to exercise ParentClosePolicy: ${(e as Error).message}`,
      hint:
        `This check starts ${target.type}, discovers its child workflow's real ID from event history, and ` +
        "terminates the parent while the child is in flight. This failure is about setting that up, not about " +
        `orphaning behavior itself — confirm workflows[].sampleInput is valid for ${target.type}.`,
    };
  }
};
