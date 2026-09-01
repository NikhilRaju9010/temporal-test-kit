import { NativeConnection, Worker } from "@temporalio/worker";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, createEphemeralEnvironment } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { registerCleanup } from "../cleanup-registry.js";
import { l1ContinueSignal } from "./fixtures/l1-two-task-workflow.js";
import { raceWithTimeout } from "../race.js";
import { fixturePath } from "../fixture-path.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "L1")!;

const TASK_QUEUE = "ttk-l1";
const WORKFLOWS_PATH = fixturePath(import.meta.url, import.meta.dirname, "l1-two-task-workflow");
const STARTUP_WAIT_MS = 300;
const RESULT_WAIT_MS = 10_000;

const TARGET_LABEL = "L1TwoTaskWorkflow (internal probe — connection-loss only, not full server outage)";

/**
 * L1's catalog name is "Temporal Server outage recovery," but that faithful
 * test is NOT what this check runs — and it says so, explicitly, in both
 * `target` and `message`/`hint` below, per the same honesty principle the
 * whole tool is built on (never let a report imply broader coverage than
 * what was actually tested).
 *
 * A faithful version would pause the actual Temporal *server* process and
 * confirm the worker survives it coming back. `TestWorkflowEnvironment`
 * exposes no such pause/resume for its embedded server (only a one-way,
 * permanent `teardown()`), and the underlying native binding
 * (`@temporalio/core-bridge`) has no such capability to reach for either —
 * confirmed while investigating this check, not assumed. What IS buildable
 * locally, and what this check actually does: start a probe workflow, run
 * its first workflow task against one `NativeConnection`, explicitly CLOSE
 * that connection (a real, verifiable disconnect — not a simulation), then
 * open a brand-new connection + worker and confirm the workflow's second
 * task gets picked up and it completes normally. That proves the SDK/worker
 * layer recovers cleanly from a lost connection — a materially narrower
 * claim than "survives the server actually being down," since the real
 * server (and every other check sharing the shared `env`) is completely
 * unaffected throughout; this check runs its own private, disposable
 * environment for exactly that reason, same as I1/I5.
 *
 * Two sequential in-process `Worker`/`NativeConnection` pairs — the
 * documented CLAUDE.md exception to always booting through
 * `withRunningWorker`, same precedent as D1/I5. Not I1's
 * `spawnKillableWorker`: I1 kills a WORKER process to test crash recovery;
 * this check kills a CONNECTION to test reconnection — different failure
 * modes, so it doesn't reuse that infra (see the plan discussed before
 * building either).
 */
export async function checkL1ConnectionLossRecovery(
  _env: EphemeralEnvironment,
  _target: WorkerTarget & { workflowType: string },
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: TARGET_LABEL,
    engine: "dynamic-zero-fixture" as const,
  };

  const privateEnv = await createEphemeralEnvironment();
  let privateEnvTorndown = false;
  const teardownPrivateEnv = async () => {
    if (privateEnvTorndown) return;
    privateEnvTorndown = true;
    await privateEnv.teardown();
  };
  const unregisterPrivateEnvCleanup = registerCleanup(teardownPrivateEnv);

  try {
    const workflowId = generateWorkflowId("L1", "L1TwoTaskWorkflow");

    const firstConnection = await NativeConnection.connect({ address: privateEnv.address, tls: false });
    const unregisterFirstConnCleanup = registerCleanup(() => firstConnection.close().catch(() => {}));

    const firstWorker = await Worker.create({
      connection: firstConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: WORKFLOWS_PATH,
      activities: {},
    });
    const firstRunPromise = firstWorker.run();
    firstRunPromise.catch(() => {});

    const handle = await privateEnv.client.workflow.start("L1TwoTaskWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [],
    });

    // Give the workflow a brief moment to run its first workflow task
    // (register the signal handler, enter `condition()`) before the
    // connection it's being served over goes away.
    await new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT_MS));

    firstWorker.shutdown();
    await firstRunPromise;

    // The connection loss: close the connection this worker was using —
    // a real, verifiable disconnect, not a stand-in for one.
    unregisterFirstConnCleanup();
    await firstConnection.close();

    // Reconnect: a brand-new connection + worker, simulating whatever it
    // takes in practice to recover from a dropped connection (a process
    // restart, a reconnect loop, etc.) — this check doesn't care how, only
    // that a fresh connection can pick the workflow back up.
    const secondConnection = await NativeConnection.connect({ address: privateEnv.address, tls: false });
    const unregisterSecondConnCleanup = registerCleanup(() => secondConnection.close().catch(() => {}));

    const secondWorker = await Worker.create({
      connection: secondConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: WORKFLOWS_PATH,
      activities: {},
    });
    const secondRunPromise = secondWorker.run();
    secondRunPromise.catch(() => {});

    let result: string | undefined;
    let error: Error | undefined;
    try {
      await handle.signal(l1ContinueSignal);
      result = await raceWithTimeout(handle.result(), RESULT_WAIT_MS, () => {
        throw new Error(`workflow did not complete within ${RESULT_WAIT_MS}ms`);
      });
    } catch (e) {
      error = e as Error;
    } finally {
      secondWorker.shutdown();
      await secondRunPromise;
      unregisterSecondConnCleanup();
      await secondConnection.close();
    }

    if (error) {
      return {
        ...base,
        status: "FAIL",
        message: `Probe workflow did not resume after its connection was closed and a fresh connection reconnected: ${error.message}`,
        hint:
          "This checks connection-loss recovery specifically, not a full server outage (no local API exists to " +
          "pause/resume the embedded test server, so that broader claim isn't tested here). If the workflow " +
          "doesn't resume once a new connection is established, workflows in the target project could stall " +
          "indefinitely any time a worker's underlying connection drops — even though the Temporal server " +
          "itself never went down.",
      };
    }

    if (result !== "done") {
      return {
        ...base,
        status: "FAIL",
        message: `Probe workflow completed with an unexpected result after connection reconnection: ${JSON.stringify(result)}`,
        hint:
          "The probe workflow was expected to return 'done' after its second workflow task ran over the new " +
          "connection. An unexpected result suggests the workflow's state wasn't picked back up correctly once " +
          "the original connection was replaced.",
      };
    }

    return {
      ...base,
      status: "PASS",
      message:
        "Closed the worker's NativeConnection mid-workflow (a real, verified disconnect) and confirmed a fresh " +
        "connection + worker picked the workflow back up and completed it normally. NOTE: this tests " +
        "connection-loss recovery specifically, not a full server outage — no local API exists to pause/resume " +
        "the embedded test server (TestWorkflowEnvironment only supports a one-way teardown, and the underlying " +
        "core-bridge binding has no such capability either), so the real server stayed up and unaffected " +
        "throughout this check. Treat a PASS here as evidence the SDK reconnects cleanly, not as proof of " +
        "outage survival.",
      hint: null,
    };
  } finally {
    unregisterPrivateEnvCleanup();
    await teardownPrivateEnv();
  }
}
