import { join } from "node:path";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "B5")!;

// Bounded wait for a cancelled workflow to reach a terminal state. ~5s
// leaves real headroom under the orchestrator's 15s per-check ceiling (see
// CLAUDE.md's "Per-check timeout and error isolation") even in the worst
// case, where this check runs the wait twice (see checkB5CancellationStops).
const GRACE_PERIOD_MS = 5_000;
const POLL_INTERVAL_MS = 250;

// A private, always-cancellable control fixture — see the long comment in
// checkB5CancellationStops for why this exists and when it's used.
const CONTROL_FIXTURE_PATH = join(import.meta.dirname, "fixtures", "b5-hanging-workflow.ts");
const CONTROL_WORKFLOW_TYPE = "GreetingWorkflow";

interface CancellationOutcome {
  /**
   * A workflow *execution's* terminal status name. NOTE: this is spelled
   * "CANCELLED" (double L) in @temporalio/client's WorkflowExecutionStatusName
   * — distinct from the *activity* execution status enum, which uses the
   * single-L "CANCELED". Verified empirically against a real ephemeral
   * environment (TestWorkflowEnvironment + a live worker) before writing
   * this check; get this wrong and the PASS branch below would silently
   * never fire.
   */
  finalStatus: string;
  cancelError: string | null;
}

/**
 * Starts `workflowType` (from `workflowsPath`, on `taskQueue`) with no
 * args, cancels it immediately, then polls `describe()` up to
 * GRACE_PERIOD_MS for it to leave RUNNING. Always goes through
 * `withRunningWorker` per CLAUDE.md's worker-boot convention.
 */
async function startAndCancel(
  env: EphemeralEnvironment,
  taskQueue: string,
  activities: Record<string, unknown>,
  workflowType: string,
  workflowsPath: string,
  testId: string,
  signal?: AbortSignal,
): Promise<CancellationOutcome> {
  const workerTarget: WorkerTarget = { workflowsPath, activities, taskQueue };

  return withRunningWorker(
    env,
    workerTarget,
    async () => {
    const handle = await env.client.workflow.start(workflowType, {
      taskQueue,
      workflowId: generateWorkflowId(testId, workflowType),
      args: [],
    });

    let cancelError: string | null = null;
    try {
      await handle.cancel();
    } catch (e) {
      // A cancel request can fail outright (e.g. the workflow was already
      // gone by the time it arrived); the outcome is still fully determined
      // by describe() below, so this is recorded but not fatal.
      cancelError = (e as Error).message;
    }

    const deadline = Date.now() + GRACE_PERIOD_MS;
    let finalStatus = "UNKNOWN";
    while (Date.now() < deadline) {
      const description = await handle.describe();
      finalStatus = description.status.name;
      if (finalStatus !== "RUNNING") break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

      return { finalStatus, cancelError };
    },
    signal,
  );
}

/**
 * B5 is scoped (per the catalog/spec) to whether workflow-level cancellation
 * propagates and takes effect promptly — not to interrupting a specific
 * long-running activity mid-flight, which is a harder, fixture-dependent
 * variant out of scope here. Temporal cancels a workflow promptly by
 * default unless its own code deliberately shields itself from that (e.g.
 * `CancellationScope.nonCancellable`, or catching a `CancelledFailure`
 * without re-throwing), so this is directly testable with zero fixture
 * data: start `target.workflowType` with no args, cancel it immediately,
 * and see whether it reaches CANCELLED.
 *
 * DESIGN DECISION — why this runs against the real target first, with a
 * private-fixture fallback, rather than either purely one or the other:
 *
 * Running only against a private fixture (permitted by this check's design
 * brief) would make the check reliable but empty — it would always PASS
 * regardless of whether the *target project's* workflows actually swallow
 * cancellation, which is the whole point of a check named "cancelling a
 * step actually stops it."  Running only against `target.workflowType`, as
 * plain as `checkA1WorkflowStarts` does for its own concern, sounds more
 * honest but was verified empirically (against a live ephemeral
 * environment) to have a real flaw: a workflow with no `await` at all
 * reliably completes before `handle.cancel()` can be delivered and takes
 * effect, landing on COMPLETED instead of CANCELLED — and that's
 * indistinguishable, from the client's point of view, from a workflow that
 * *caught* the cancellation and returned normally instead of propagating
 * it (the actual bug this check exists to catch). Grading that ambiguous
 * case as FAIL would false-positive against fast, well-behaved target
 * workflows under zero-fixture input; grading it PASS would hide the real
 * bug.
 *
 * So: try the real target first. CANCELLED or still-RUNNING-past-grace are
 * both unambiguous and graded directly from the target's own behavior. Only
 * when the target reaches some *other* terminal state without ever passing
 * through CANCELLED — genuinely ambiguous — does this fall back to
 * `fixtures/b5-hanging-workflow.ts`, a workflow guaranteed to still be
 * RUNNING when cancelled, run on the same worker/task queue. That answers a
 * narrower question (does this project's worker/task-queue setup honor
 * cancellation at all) instead of guessing at the ambiguous case.
 */
export async function checkB5CancellationStops(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.workflowType,
    engine: "dynamic-zero-fixture" as const,
  };

  const primary = await startAndCancel(
    env,
    target.taskQueue,
    target.activities,
    target.workflowType,
    target.workflowsPath,
    "B5",
    signal,
  );

  if (primary.finalStatus === "CANCELLED") {
    return {
      ...base,
      status: "PASS",
      message: `${target.workflowType} was cancelled and reached CANCELLED within ${GRACE_PERIOD_MS}ms — cancellation took effect promptly.`,
      hint: null,
    };
  }

  if (primary.finalStatus === "RUNNING") {
    return {
      ...base,
      status: "FAIL",
      message: `${target.workflowType} was still RUNNING ${GRACE_PERIOD_MS}ms after handle.cancel() was called — it did not honor the cancellation request.`,
      hint:
        "A workflow that doesn't respond to cancellation within a reasonable time can leave orphaned executions " +
        "running indefinitely, wasting worker capacity and skipping any cleanup/compensation logic meant to run " +
        "on cancel. Check whether the workflow code is catching a CancelledFailure (or running the relevant logic " +
        "inside a non-cancellable scope) without re-throwing/propagating it — Temporal cancels a workflow " +
        "promptly by default unless its own code deliberately shields it from that.",
    };
  }

  // Ambiguous: target reached a terminal state other than CANCELLED without
  // ever having been observed RUNNING-past-cancel. See the design comment
  // on this function for why this isn't graded directly.
  const fallback = await startAndCancel(
    env,
    target.taskQueue,
    target.activities,
    CONTROL_WORKFLOW_TYPE,
    CONTROL_FIXTURE_PATH,
    "B5-control",
    signal,
  );

  const raceNote =
    `${target.workflowType} reached ${primary.finalStatus} (not CANCELLED) after being cancelled, most likely ` +
    `because it ran to completion before the cancellation request could take effect — with no fixture input, a ` +
    `workflow may simply finish too fast for this check to observe an interruption.`;

  if (fallback.finalStatus === "CANCELLED") {
    return {
      ...base,
      status: "PASS",
      message:
        `${raceNote} A control workflow run on the same worker/task queue was cancelled successfully, confirming ` +
        `cancellation is honored generically here — this is graded as an inconclusive race against ` +
        `${target.workflowType}'s own speed, not a finding against it.`,
      hint: null,
    };
  }

  return {
    ...base,
    status: "FAIL",
    message:
      `${raceNote} A control workflow run on the same worker/task queue also failed to reach CANCELLED within ` +
      `${GRACE_PERIOD_MS}ms (ended in ${fallback.finalStatus}), which points at the cancellation path itself ` +
      `rather than ${target.workflowType}'s own timing.`,
    hint:
      "A workflow that doesn't respond to cancellation within a reasonable time can leave orphaned executions " +
      "running indefinitely. Because even a minimal control workflow with no business logic failed to reach " +
      "CANCELLED here, look at the worker/environment setup (e.g. an interceptor or sandbox configuration that " +
      "could be suppressing cancellation) rather than any single workflow's code.",
  };
}
