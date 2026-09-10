import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { WaitBudgetsConfig } from "../../../config/schema.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "J3")!;

// Bounded internal wait for the workflow to reach a terminal state. Kept
// under the orchestrator's 15s per-check ceiling (see CLAUDE.md's "Per-check
// timeout and error isolation") so this check has room to finish its own
// bookkeeping (describe() + result formatting) before runCheckWithGuards
// would time it out and report ERRORED instead of our own result.
const WAIT_TIMEOUT_MS = 8_000;

const SKIPPED_HINT =
  "This zero-fixture run of the workflow did not produce a failure to grade — it either completed " +
  "successfully or was still running when the bounded wait expired, so there's no error message to evaluate " +
  "for usefulness. Many real workflows *do* fail naturally when started with no arguments (missing required " +
  "input), which is what lets this check activate opportunistically today, but a project whose workflow " +
  "tolerates undefined input (like this sample project's GreetingWorkflow) simply won't produce a failure this " +
  "way. Configuring a deliberately-invalid `workflows[].sampleInput` in a future config (Phase 3 fixture data, " +
  "not yet built) would let this check reliably trigger a real failure and grade its message every run, instead " +
  "of only when a project happens to fail on empty input.";

/**
 * A tiny, deliberately conservative heuristic for "is this error message
 * useless": empty/whitespace-only, an exact match (case-insensitive) against
 * a short list of known-generic placeholder strings real SDKs/frameworks
 * sometimes surface verbatim, or under ~10 characters with no other content.
 * Anything else is trusted as useful — judging whether a message is *good*
 * (names the failing field, suggests a fix, etc.) is a much harder, more
 * subjective problem than this tool should try to automate; this only
 * catches the clearly-useless case rather than attempting real quality
 * scoring.
 */
const KNOWN_USELESS_MESSAGES = new Set([
  "error",
  "failed",
  "failure",
  "activity failed",
  "workflow failed",
  "an error occurred",
  "unknown error",
  "internal error",
  "something went wrong",
]);
const MIN_USEFUL_LENGTH = 10;

export function isUselessFailureMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return true;
  if (KNOWN_USELESS_MESSAGES.has(trimmed.toLowerCase())) return true;
  if (trimmed.length < MIN_USEFUL_LENGTH) return true;
  return false;
}

/**
 * Walks an error's `.cause` chain (e.g. `WorkflowFailedError` -> `ActivityFailure`
 * -> `ApplicationFailure`) and returns the deepest cause's message — that's
 * the original thrown message from the workflow/activity code, rather than a
 * generic wrapper message like "Workflow execution failed" from an outer
 * client-side error class.
 */
export function extractFailureMessage(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.message) messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }

  return messages.length > 0 ? messages[messages.length - 1] : "";
}

export async function checkJ3FailureMessages(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
  waitBudgets?: WaitBudgetsConfig,
): Promise<TestResult> {
  const waitTimeoutMs = waitBudgets?.J3?.waitTimeoutMs ?? WAIT_TIMEOUT_MS;
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.workflowType,
    engine: "dynamic-zero-fixture" as const,
  };

  const workflowId = generateWorkflowId("J3", target.workflowType);

  return withRunningWorker(env, target, async () => {
    const handle = await env.client.workflow.start(target.workflowType, {
      taskQueue: target.taskQueue,
      workflowId,
      args: [],
    });

    await raceWithTimeout(handle.result().catch(() => {}), waitTimeoutMs, () => undefined);

    // Source of truth for the terminal state is `describe()`, not whether
    // the raced `result()` promise above happened to settle before the
    // timeout branch won the race (it can settle just after, which would
    // make a boolean flag set inside its .then/.catch unreliable here) —
    // same pattern as checkA1WorkflowStarts.
    const description = await handle.describe();
    const statusName = description.status.name;

    if (statusName !== "FAILED") {
      // Either it completed successfully, or it's still running after the
      // bounded wait — neither gives this check an actual failure to grade.
      // Best-effort cleanup so a still-running workflow's long-poll doesn't
      // outlive this check on the shared connection (see A1's same pattern).
      if (statusName === "RUNNING") {
        await handle.terminate("temporal-test-kit J3 check: bounded wait expired, no failure produced").catch(
          () => {},
        );
        await raceWithTimeout(handle.result().catch(() => {}), 3_000, () => undefined);
      }

      return {
        ...base,
        status: "SKIPPED",
        message:
          statusName === "COMPLETED"
            ? `${target.workflowType} started with no arguments and completed successfully — no failure was produced to grade.`
            : `${target.workflowType} ended in status ${statusName} after waiting ${waitTimeoutMs}ms — no failure was produced to grade.`,
        hint: SKIPPED_HINT,
      };
    }

    const failureError = await handle.result().catch((e) => e);
    const failureMessage = extractFailureMessage(failureError);

    if (isUselessFailureMessage(failureMessage)) {
      return {
        ...base,
        status: "FAIL",
        message: `${target.workflowType} failed with a generic, uninformative error message: ${
          failureMessage ? `"${failureMessage}"` : "(empty)"
        }`,
        hint:
          "A failure message like this gives an on-call engineer nothing to act on — no field name, no " +
          "expected-vs-actual value, no indication of what to fix. Throw (or wrap activity errors in) an " +
          "ApplicationFailure/Error with a message that names what specifically went wrong, e.g. which input " +
          "was missing or invalid and what was expected instead.",
      };
    }

    return {
      ...base,
      status: "PASS",
      message: `${target.workflowType} failed with a specific error message: "${failureMessage}"`,
      hint: null,
    };
  }, signal);
}
