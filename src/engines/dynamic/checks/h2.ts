import { WorkflowHandle } from "@temporalio/client";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { WaitBudgetsConfig } from "../../../config/schema.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { fixturePath } from "../fixture-path.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "H2")!;

/**
 * H2 checks a pure SDK/server behavior — does `handle.terminate()` promptly
 * move a *live* execution to TERMINATED — with zero dependency on the target
 * project's business logic. Rather than start `target.workflowType` (which,
 * per examples/sample-project's zero-input GreetingWorkflow, may already be
 * COMPLETED by the time terminate() fires — see A1/A3's comments on the same
 * hazard), H2 starts its own throwaway probe workflow that waits forever, so
 * it's guaranteed to still be RUNNING when terminated. See
 * fixtures/h2-hanging-workflow.ts for the full reasoning. `target.workflowType`
 * itself is unused here (only `target.taskQueue` and `target.activities` are
 * — the probe needs no activities, but withRunningWorker's WorkerTarget shape
 * takes them regardless); the returned TestResult's `target` field names the
 * probe workflow, not the project's own workflow.
 */
const PROBE_WORKFLOW_TYPE = "H2ProbeWorkflow";
const PROBE_WORKFLOWS_PATH = fixturePath(import.meta.url, import.meta.dirname, "h2-hanging-workflow");

// Bounded grace period for the terminated execution to actually reach
// TERMINATED, kept comfortably under the orchestrator's 15s per-check
// ceiling (see CLAUDE.md's "Per-check timeout and error isolation") so this
// check still has room for its own start/terminate/describe bookkeeping
// before runCheckWithGuards would time it out and report ERRORED instead of
// our own PASS/FAIL.
const DEFAULT_GRACE_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export interface TerminateOutcome {
  /** True only if the execution was observed reaching TERMINATED in time. */
  terminated: boolean;
  /** Set if `handle.terminate()` itself threw, instead of the execution just not reaching TERMINATED in time. */
  terminateError: string | null;
  /** Last observed `describe().status.name`, for FAIL messages. */
  lastStatus: string;
}

/**
 * Calls `handle.terminate()` and polls `handle.describe()` (rather than
 * racing `handle.result()`, whose rejection type/shape for a terminated
 * workflow isn't the thing being graded here) until the execution reaches
 * TERMINATED or `graceMs` elapses. Exported standalone — separate from
 * `checkH2TerminateSkipsCleanup` below — so tests can drive it directly:
 * against a real live probe for the happy path, and with a near-zero
 * `graceMs` (or a handle for an already-closed execution) to exercise the
 * FAIL branches without needing to fake or slow down the real SDK/server.
 */
export async function terminateAndAwaitTerminated(
  handle: WorkflowHandle,
  reason: string,
  graceMs: number = DEFAULT_GRACE_MS,
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Promise<TerminateOutcome> {
  try {
    await handle.terminate(reason);
  } catch (e) {
    return { terminated: false, terminateError: (e as Error).message, lastStatus: "" };
  }

  const deadline = Date.now() + graceMs;
  let lastStatus = "";
  do {
    const description = await handle.describe();
    lastStatus = description.status.name;
    if (lastStatus === "TERMINATED") {
      return { terminated: true, terminateError: null, lastStatus };
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0))));
  } while (Date.now() < deadline);

  return { terminated: false, terminateError: null, lastStatus };
}

export async function checkH2TerminateSkipsCleanup(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
  waitBudgets?: WaitBudgetsConfig,
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: PROBE_WORKFLOW_TYPE,
    engine: "dynamic-zero-fixture" as const,
  };

  const probeTarget: WorkerTarget = {
    workflowsPath: PROBE_WORKFLOWS_PATH,
    activities: target.activities,
    taskQueue: target.taskQueue,
  };

  const workflowId = generateWorkflowId("H2", PROBE_WORKFLOW_TYPE);

  return withRunningWorker(env, probeTarget, async () => {
    const handle = await env.client.workflow.start(PROBE_WORKFLOW_TYPE, {
      taskQueue: target.taskQueue,
      workflowId,
      args: [],
    });

    const graceMs = waitBudgets?.H2?.graceMs ?? DEFAULT_GRACE_MS;
    const outcome = await terminateAndAwaitTerminated(handle, "temporal-test-kit H2 check: verifying terminate() takes effect", graceMs);

    if (outcome.terminateError !== null) {
      return {
        ...base,
        status: "FAIL",
        message: `handle.terminate() itself threw for a live probe workflow: ${outcome.terminateError}`,
        hint:
          "terminate() is meant to work unconditionally on an open execution, regardless of what the workflow " +
          "code is doing. terminate() failing to even issue could mean stuck/zombie executions accumulate even " +
          "when explicitly told to stop — check the Temporal server connection and SDK/server version " +
          "compatibility rather than the target project's workflow code.",
      };
    }

    if (outcome.terminated) {
      return {
        ...base,
        status: "PASS",
        message:
          "handle.terminate() moved a live workflow execution to TERMINATED promptly. Skipping the workflow's " +
          "normal completion/cleanup path here is EXPECTED and correct — terminate() is deliberately the " +
          '"stop now, no cleanup" tool (unlike cancel, which requests a graceful, catchable exit).',
        hint: null,
      };
    }

    return {
      ...base,
      status: "FAIL",
      message: `A terminated workflow execution did not reach TERMINATED status in time (last observed status: ${outcome.lastStatus || "unknown"}).`,
      hint:
        "terminate() is expected to move an open execution to TERMINATED promptly and unconditionally. Not " +
        "observing that within a generous grace period could mean stuck/zombie executions accumulate even when " +
        "explicitly told to stop — investigate Temporal server/worker health, since terminate() is server-driven " +
        "and isn't supposed to depend on the workflow code cooperating at all.",
    };
  }, signal);
}
