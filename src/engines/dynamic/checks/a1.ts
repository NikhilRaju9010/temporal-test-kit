import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "A1")!;

// Bounded internal wait for the workflow to reach a terminal state. Kept
// under the orchestrator's 15s per-check ceiling (see CLAUDE.md's "Per-check
// timeout and error isolation") so this check has room to finish its own
// bookkeeping (describe() + result formatting) before runCheckWithGuards
// would time it out and report ERRORED instead of our own FAIL/PASS.
const WAIT_TIMEOUT_MS = 8_000;

const NO_FIXTURE_HINT_SUFFIX =
  "This is a zero-fixture check — no `workflows[].sampleInput` is configured for this workflow, so it was " +
  "started with no arguments. Configuring sample input in a future config (Phase 3 fixture data, not yet " +
  "built) would make this check more precise.";

/**
 * Starts `target.workflowType` on `target.taskQueue` with no arguments
 * (zero-fixture: there's no sample input to pass), waits up to
 * WAIT_TIMEOUT_MS for it to reach a terminal state, then grades the outcome
 * from its actual execution status rather than from whether `handle.result()`
 * resolved or rejected — that keeps "the workflow legitimately failed" and
 * "the workflow is still running" as distinct, correctly-labeled outcomes.
 */
export async function checkA1WorkflowStarts(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.workflowType,
    engine: "dynamic-zero-fixture" as const,
  };

  const workflowId = generateWorkflowId("A1", target.workflowType);

  return withRunningWorker(env, target, async () => {
    const handle = await env.client.workflow.start(target.workflowType, {
      taskQueue: target.taskQueue,
      workflowId,
      args: [],
    });

    let resultValue: unknown;
    let resultCaptured = false;
    await raceWithTimeout(
      handle
        .result()
        .then((r) => {
          resultValue = r;
          resultCaptured = true;
        })
        .catch(() => {
          // Failure is reflected in describe().status below; nothing to do here.
        }),
      WAIT_TIMEOUT_MS,
      () => undefined,
    );

    const description = await handle.describe();
    const statusName = description.status.name;

    if (statusName === "RUNNING") {
      // Best-effort cleanup: without this, the `handle.result()` long-poll
      // started above keeps polling indefinitely in the background for a
      // workflow that will never complete. Since checkA1 shares one
      // ephemeral environment/connection with every other zero-fixture
      // check (see CLAUDE.md's workflow ID convention note), an
      // unterminated poll can outlive this check and throw once the shared
      // connection eventually tears down. Termination is what lets the
      // pending long-poll resolve (as terminated) instead of hanging.
      await handle.terminate("temporal-test-kit A1 check: bounded wait expired").catch(() => {});
      await raceWithTimeout(handle.result().catch(() => {}), 3_000, () => undefined);
    }

    if (statusName === "COMPLETED") {
      const outputNote = resultCaptured && resultValue !== undefined ? " and produced output" : "";
      return {
        ...base,
        status: "PASS",
        message: `${target.workflowType} started with no arguments and completed successfully${outputNote}.`,
        hint: null,
      };
    }

    if (statusName === "FAILED") {
      return {
        ...base,
        status: "FAIL",
        message: `${target.workflowType} started with no arguments and ended in FAILED status.`,
        hint:
          `Because this is a zero-fixture check, this failure may simply mean the workflow legitimately ` +
          `requires valid business input it wasn't given here — not necessarily an application bug. But it ` +
          `could also mean the workflow doesn't validate or handle missing/invalid input gracefully (e.g. it ` +
          `should reject cleanly or apply a sensible default instead of erroring), so this is still worth a ` +
          `human look. ${NO_FIXTURE_HINT_SUFFIX}`,
      };
    }

    if (statusName === "RUNNING") {
      return {
        ...base,
        status: "FAIL",
        message: `${target.workflowType} was still RUNNING after waiting ${WAIT_TIMEOUT_MS}ms for it to reach a terminal state.`,
        hint:
          `Because this is a zero-fixture check, the workflow may legitimately be waiting on a signal or query ` +
          `that this run never sent — not necessarily a bug. But a workflow that's expected to complete quickly ` +
          `and instead sits RUNNING indefinitely is worth investigating (e.g. an unmet condition(), a missing ` +
          `signal handler, or an activity that never resolves). ${NO_FIXTURE_HINT_SUFFIX}`,
      };
    }

    return {
      ...base,
      status: "FAIL",
      message: `${target.workflowType} ended in unexpected status ${statusName}.`,
      hint:
        `The workflow reached a terminal state other than COMPLETED or FAILED (status: ${statusName}), which is ` +
        `unexpected for a normal run. ${NO_FIXTURE_HINT_SUFFIX}`,
    };
  });
}
