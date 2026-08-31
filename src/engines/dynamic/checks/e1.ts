import { join } from "node:path";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "E1")!;

const TASK_QUEUE = "ttk-e1";
const WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "e1-continue-as-new-workflow.ts");
const RESULT_WAIT_MS = 15_000;

/**
 * E1 proves that Continue-As-New actually works as a mechanism: a workflow
 * can reset its own event history mid-execution (producing a new Run ID
 * under the same Workflow ID) and still ultimately complete correctly. This
 * is a property of the Temporal SDK/server, not of the target project's
 * specific business logic — whether the target's own workflow is even
 * *designed* to run long enough to need Continue-As-New is Phase 3 fixture
 * data (`workflows[].isLongRunning`) this zero-fixture check doesn't have.
 * So, same reasoning as D1, this check does NOT exercise `target.workflowType`
 * at all — it builds its own throwaway probe workflow
 * (`fixtures/e1-continue-as-new-workflow.ts`) that continues-as-new twice
 * before returning "done", and runs *that*. `target`/`env` are still
 * accepted (and `env` genuinely is used, unlike D1) so this check keeps the
 * same signature shape as every other check in this engine. The returned
 * `TestResult.target` names the internal probe workflow instead of
 * `target.workflowType` for the same reason, and `message` says so
 * explicitly so this doesn't read as an oversight.
 *
 * Unlike D1, this check does NOT need a worker restart or a private
 * environment — Continue-As-New is entirely a within-execution mechanism
 * (no worker needs to stop/start for it to occur), so the shared `env`
 * passed in and the normal `withRunningWorker` path are used directly,
 * pointed at this check's own fixture `workflowsPath`.
 */
export async function checkE1ContinueAsNew(
  env: EphemeralEnvironment,
  _target: WorkerTarget & { workflowType: string },
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: "E1ContinueAsNewWorkflow (internal probe)",
    engine: "dynamic-zero-fixture" as const,
  };

  const probeTarget: WorkerTarget = {
    workflowsPath: WORKFLOWS_PATH,
    activities: {},
    taskQueue: TASK_QUEUE,
  };

  const workflowId = generateWorkflowId("E1", "E1ContinueAsNewWorkflow");

  const outcome = await withRunningWorker(env, probeTarget, async () => {
    // `start()` returns a handle carrying `firstExecutionRunId` — the Run ID
    // of the FIRST execution in the chain, before any continue-as-new. Its
    // history is what will contain the WorkflowExecutionContinuedAsNew
    // event; the history under the *current* run ID (or under `workflowId`
    // with no runId, which resolves to the most recent run) is a fresh
    // history that starts over post-reset and won't contain it.
    const handle = await env.client.workflow.start("E1ContinueAsNewWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [],
    });
    const firstExecutionRunId = handle.firstExecutionRunId;

    let result: string | undefined;
    let error: Error | undefined;
    try {
      result = await Promise.race([
        handle.result(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`workflow did not complete within ${RESULT_WAIT_MS}ms`)), RESULT_WAIT_MS),
        ),
      ]);
    } catch (e) {
      error = e as Error;
    }

    const firstRunHandle = env.client.workflow.getHandle(workflowId, firstExecutionRunId);
    const firstRunHistory = await firstRunHandle.fetchHistory();
    const continuedAsNew = (firstRunHistory.events ?? []).some(
      (e) => e.workflowExecutionContinuedAsNewEventAttributes != null,
    );

    return { result, error, continuedAsNew };
  });

  if (outcome.error) {
    return {
      ...base,
      status: "FAIL",
      message: `Continue-As-New probe workflow did not complete: ${outcome.error.message}`,
      hint:
        "This check starts an internal probe workflow (not the target project's own workflow — E1 tests a " +
        "property of Temporal itself, independent of any project code) that calls continueAsNew() twice before " +
        "returning. A broken Continue-As-New leaves long-running workflows unable to prevent their own event " +
        "history from growing unboundedly, and they will eventually hit Temporal's history size/count limits and " +
        "get forcibly terminated. Check the worker's workflow bundle compiled correctly and that the SDK version " +
        "in use supports continueAsNew().",
    };
  }

  if (!outcome.continuedAsNew) {
    return {
      ...base,
      status: "FAIL",
      message:
        `Continue-As-New probe workflow completed with result ${JSON.stringify(outcome.result)}, but no ` +
        "WorkflowExecutionContinuedAsNew event was found in its first run's history — could not confirm the " +
        "history reset actually happened.",
      hint:
        "The probe workflow calls continueAsNew() and is expected to leave a WorkflowExecutionContinuedAsNew " +
        "event in its first execution's history before starting a fresh run under the same Workflow ID. Not " +
        "finding that event means either continueAsNew() silently didn't take effect, or the history couldn't be " +
        "correctly traced back to the first run — either way this is inconclusive proof that the mechanism " +
        "long-running workflows depend on to avoid unbounded history growth is actually working.",
    };
  }

  if (outcome.result !== "done") {
    return {
      ...base,
      status: "FAIL",
      message: `Continue-As-New probe workflow finished with an unexpected result: ${JSON.stringify(outcome.result)}`,
      hint:
        "The probe workflow was expected to return 'done' after continuing-as-new twice. An unexpected result " +
        "suggests state (the iteration counter) wasn't carried forward correctly across the continue-as-new " +
        "reset, which is exactly the kind of subtle bug that can silently drop long-running workflow state.",
    };
  }

  return {
    ...base,
    status: "PASS",
    message:
      "Internal probe workflow continued-as-new (confirmed via a WorkflowExecutionContinuedAsNew event in its " +
      "first run's history) and ultimately completed correctly across the history reset. This check exercises an " +
      "internal probe workflow, not the target project's own workflow, since the Continue-As-New mechanism is a " +
      "property of Temporal itself rather than of the project under test.",
    hint: null,
  };
}
