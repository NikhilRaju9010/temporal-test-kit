import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { createEphemeralEnvironment, bootWorker } from "./environment.js";
import { withFaultInjectedWorker } from "./fault-injection.js";
import { generateWorkflowId } from "./workflow-id.js";
import { runAllCleanups } from "./cleanup-registry.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("withFaultInjectedWorker (real @temporalio/testing + sample project)", () => {
  it("runs the project's real activities except the one named, which is replaced by the injected fault", async () => {
    const env = await createEphemeralEnvironment();
    try {
      const activities = await loadActivities();

      const result = await withFaultInjectedWorker(
        env,
        { taskQueue: "ttk-fault-test", workflowsPath: WORKFLOWS_PATH, activities },
        "formatGreetingActivity",
        async () => {
          throw new Error("INJECTED_FAULT");
        },
        async () => {
          const handle = await env.client.workflow.start("GreetingWorkflow", {
            taskQueue: "ttk-fault-test",
            workflowId: generateWorkflowId("FAULT-TEST", "GreetingWorkflow"),
            args: ["World"],
          });
          try {
            await handle.result();
            return "unexpectedly succeeded";
          } catch (e) {
            // handle.result() wraps the activity's real error as .cause,
            // reporting only "Workflow execution failed" at the top level.
            let err: unknown = e;
            let combined = "";
            while (err instanceof Error) {
              combined += err.message + " ";
              err = err.cause;
            }
            return combined;
          }
        },
      );

      expect(result).toMatch(/INJECTED_FAULT/);
    } finally {
      await env.teardown();
    }
  }, 30_000);

  it("rejects with a clear error if the named activity doesn't exist in the project's activities module", async () => {
    const env = await createEphemeralEnvironment();
    try {
      const activities = await loadActivities();
      await expect(
        withFaultInjectedWorker(
          env,
          { taskQueue: "ttk-fault-test-2", workflowsPath: WORKFLOWS_PATH, activities },
          "doesNotExistActivity",
          async () => {},
          async () => {},
        ),
      ).rejects.toThrow(/doesNotExistActivity/);
    } finally {
      await env.teardown();
    }
  }, 15_000);

  it("shuts the worker down cleanly when the callback throws (mirrors withRunningWorker's guarantee)", async () => {
    const env = await createEphemeralEnvironment();
    const activities = await loadActivities();
    await expect(
      withFaultInjectedWorker(
        env,
        { taskQueue: "ttk-fault-test-3", workflowsPath: WORKFLOWS_PATH, activities },
        "formatGreetingActivity",
        async () => "fault",
        async () => {
          throw new Error("callback failure");
        },
      ),
    ).rejects.toThrow("callback failure");
    // If the worker's connection reference wasn't released, this throws
    // IllegalStateError — the same regression environment.test.ts already
    // guards for bootWorker.
    await env.teardown();
  }, 30_000);

  it("registers its worker's shutdown with the interrupt-safe cleanup registry — an interrupt DURING the callback releases the connection reference immediately, not only once withFaultInjectedWorker's own finally runs", async () => {
    const env = await createEphemeralEnvironment();
    const activities = await loadActivities();

    await withFaultInjectedWorker(
      env,
      { taskQueue: "ttk-fault-test-4", workflowsPath: WORKFLOWS_PATH, activities },
      "formatGreetingActivity",
      async () => "fault",
      async () => {
        // Simulates the SIGINT/SIGTERM handler firing while this callback
        // is still running — before withFaultInjectedWorker's own finally
        // block has had a chance to shut its worker down.
        await runAllCleanups();
        // If the worker's connection reference was released by that
        // interrupt-triggered cleanup (not just deferred to later),
        // teardown succeeds right now, from inside the still-running
        // callback — the same regression environment.test.ts guards for
        // bootWorker, proven here for the interrupt path specifically.
        // (withFaultInjectedWorker's own finally will also run afterward,
        // but its shutdownOnce() is idempotent, so this is the only
        // teardown call this test needs to make.)
        await env.teardown();
      },
    );
  }, 30_000);

  it("shuts the worker down immediately when the signal aborts, even though fn never returns", async () => {
    const env = await createEphemeralEnvironment();
    try {
      const activities = await loadActivities();
      const target = { taskQueue: "ttk-fault-test-abort", workflowsPath: WORKFLOWS_PATH, activities };
      const controller = new AbortController();

      const hangingCall = withFaultInjectedWorker(
        env,
        target,
        "formatGreetingActivity",
        async () => "fault",
        () => new Promise(() => {}), // never resolves
        controller.signal,
      );

      controller.abort();

      await expect(
        Promise.race([
          hangingCall.then(
            () => "resolved",
            () => "rejected",
          ),
          new Promise((resolve) => setTimeout(() => resolve("still pending"), 5_000)),
        ]),
      ).resolves.not.toBe("still pending");

      // Same taskQueue as target — proves the worker actually released its
      // registration, not just that the outer call settled.
      const result = await bootWorker(env, target);
      expect(result.booted).toBe(true);
    } finally {
      await env.teardown();
    }
  }, 30_000);
});
