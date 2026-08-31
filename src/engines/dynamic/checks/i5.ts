import { Worker } from "@temporalio/worker";
import { join } from "node:path";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, createEphemeralEnvironment } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { i5ContinueSignal } from "./fixtures/i5-two-task-workflow.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "I5")!;

const TASK_QUEUE = "ttk-i5";
const WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "i5-two-task-workflow.ts");
const STARTUP_WAIT_MS = 300;
const RESULT_WAIT_MS = 10_000;

/**
 * I5 proves "sticky queue recovery": Temporal prefers routing a workflow's
 * NEXT task back to the worker that just handled its previous task (so it
 * can reuse cached workflow state instead of replaying history from
 * scratch). The concern this check exists for is whether that preference
 * ever becomes a hard dependency — if the originally-sticky worker is gone,
 * does the SDK/server correctly fall back to any other available worker, or
 * does the workflow stall waiting on a worker that's never coming back?
 *
 * This is a property of Temporal's server+SDK sticky-execution mechanism
 * itself, not of the target project's own workflow code — so, like D1 (a
 * sibling check with the same shape), this check does NOT exercise
 * `target.workflowType` or the shared `env`. It brings its own throwaway
 * probe workflow (`fixtures/i5-two-task-workflow.ts`) that is deliberately
 * built to require TWO separate workflow tasks (a `condition()` wait that
 * only resolves once signaled), because a workflow completing in a single
 * task never produces a "next task" that sticky affinity could get stuck
 * on. It runs against a private ephemeral environment it creates and tears
 * down itself, so its worker-stop/worker-start choreography can never
 * interfere with the other 15 zero-fixture checks sharing the main `env`.
 * `target`/`env` are still accepted so this check keeps the same signature
 * shape as every other check in this engine, and `TestResult.target` names
 * the internal probe workflow instead of `target.workflowType` for the same
 * reason (again mirroring D1).
 *
 * In-process graceful worker shutdown (`worker.shutdown()`) + a brand-new
 * `Worker` instance is a faithful way to test this: sticky recovery is
 * specifically about "the worker Temporal was stickying tasks to is no
 * longer responding for ANY reason" — which a graceful stop demonstrates
 * just as correctly as an ungraceful crash would, since sticky routing is
 * decided server-side from worker liveness/poll behavior, not from *how*
 * the worker went away. True-crash fidelity (killing an actual OS process)
 * is I1's concern, not this one — our in-process worker architecture can't
 * provide that fidelity anyway.
 */
export async function checkI5StickyRecovery(
  _env: EphemeralEnvironment,
  _target: WorkerTarget & { workflowType: string },
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: "I5TwoTaskWorkflow (internal probe)",
    engine: "dynamic-zero-fixture" as const,
  };

  // Private environment — deliberately NOT the shared `env` passed in. See
  // the doc comment above.
  const privateEnv = await createEphemeralEnvironment();

  try {
    const workflowId = generateWorkflowId("I5", "I5TwoTaskWorkflow");

    // NOTE ON THE Worker.create() CALLS BELOW: this check is one of the
    // documented exceptions to CLAUDE.md's "always boot through
    // withRunningWorker" rule (see d1.ts for the original precedent). I5
    // needs to stop a FIRST worker mid-workflow and start a SECOND worker
    // afterward against the same private environment —
    // `withRunningWorker` only supports a single create-run-shutdown cycle
    // per call. Both workers here still follow the exact same
    // run-then-shutdown-then-await pattern `withRunningWorker` uses
    // internally, so the connection reference is cleanly released before
    // `privateEnv.teardown()` runs below. Scoped to this ONE check only.

    const firstWorker = await Worker.create({
      connection: privateEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: WORKFLOWS_PATH,
      activities: {},
    });
    const firstRunPromise = firstWorker.run();
    firstRunPromise.catch(() => {
      // Surfaced via the awaited promise below; this just avoids an
      // unhandled rejection while the workflow is starting.
    });

    const handle = await privateEnv.client.workflow.start("I5TwoTaskWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [],
    });

    // Give the workflow a brief moment to run its first workflow task
    // (register the signal handler and enter `condition()`) before pulling
    // the first worker out from under it. First task is near-instant, so a
    // short fixed wait is enough.
    await new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT_MS));

    firstWorker.shutdown();
    await firstRunPromise;

    // Second, fresh worker — simulates the sticky-assigned worker being
    // gone (restarted/replaced) by the time the workflow's next task is
    // ready. The workflow now has no live worker holding a sticky cache
    // for it at all.
    const secondWorker = await Worker.create({
      connection: privateEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: WORKFLOWS_PATH,
      activities: {},
    });
    const secondRunPromise = secondWorker.run();
    secondRunPromise.catch(() => {});

    let result: string | undefined;
    let error: Error | undefined;
    try {
      // Force the workflow's second workflow task by signaling it — only
      // the new (second) worker is around to pick this up.
      await handle.signal(i5ContinueSignal);

      result = await Promise.race([
        handle.result(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`workflow did not complete within ${RESULT_WAIT_MS}ms`)), RESULT_WAIT_MS),
        ),
      ]);
    } catch (e) {
      error = e as Error;
    } finally {
      secondWorker.shutdown();
      await secondRunPromise;
    }

    if (error) {
      return {
        ...base,
        status: "FAIL",
        message: `Sticky-recovery probe workflow did not complete after its original worker was replaced: ${error.message}`,
        hint:
          "This check starts an internal probe workflow (not the target project's own workflow — I5 tests a " +
          "property of Temporal itself, independent of any project code) whose first workflow task completes " +
          "immediately, then shuts down the worker that handled it and signals the workflow so a brand-new " +
          "worker must pick up its next task. If that next task never gets processed, workflows in the target " +
          "project could get artificially stuck any time their previously-assigned worker restarts, deploys, or " +
          "scales down — even while other healthy workers are polling the same task queue.",
      };
    }

    if (result !== "done") {
      return {
        ...base,
        status: "FAIL",
        message: `Sticky-recovery probe workflow completed with an unexpected result after its worker was replaced: ${JSON.stringify(result)}`,
        hint:
          "The probe workflow was expected to return 'done' after its second workflow task ran on the new " +
          "worker. An unexpected result suggests the workflow's state wasn't picked back up correctly once " +
          "sticky affinity to the original worker fell through.",
      };
    }

    return {
      ...base,
      status: "PASS",
      message:
        "Internal probe workflow's next workflow task was picked up promptly by a new worker after the " +
        "originally sticky-assigned worker shut down — no artificial stall waiting on sticky-queue affinity to " +
        "the dead worker. This check exercises an internal probe workflow, not the target project's own " +
        "workflow, since sticky-queue recovery is a property of Temporal itself rather than of the project " +
        "under test.",
      hint: null,
    };
  } finally {
    await privateEnv.teardown();
  }
}
