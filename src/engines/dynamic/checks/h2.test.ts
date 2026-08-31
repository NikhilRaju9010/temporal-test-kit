import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment, withRunningWorker } from "../environment.js";
import { checkH2TerminateSkipsCleanup, terminateAndAwaitTerminated } from "./h2.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkH2TerminateSkipsCleanup (real @temporalio/testing + sample project)", () => {
  it("passes when terminate() moves a live probe workflow to TERMINATED promptly", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkH2TerminateSkipsCleanup(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("H2");
    expect(result.category).toBe("Cancellation & Termination");
    expect(result.name).toBe("Terminate skips cleanup (on purpose)");
    // Uses its own throwaway probe workflow rather than the target's
    // workflow, so target names the probe (see h2.ts's top comment).
    expect(result.target).toBe("H2ProbeWorkflow");
    expect(result.engine).toBe("dynamic-zero-fixture");
    expect(result.hint).toBeNull();
    // Framing must read as "this is expected/correct," not as a problem
    // being tolerated.
    expect(result.message).toMatch(/expected/i);
  }, 30_000);

  it("fails when terminate() itself throws (e.g. against an already-closed execution)", async () => {
    const activities = await loadActivities();

    await withEphemeralEnvironment(async (env) => {
      const workflowId = `ttk-h2-test-already-closed-${Date.now()}`;

      await withRunningWorker(
        env,
        { workflowsPath: WORKFLOWS_PATH, activities, taskQueue: "default" },
        async () => {
          const handle = await env.client.workflow.start("GreetingWorkflow", {
            taskQueue: "default",
            workflowId,
            args: ["world"],
          });
          // Let the (near-instant) workflow actually complete first.
          await handle.result();

          const outcome = await terminateAndAwaitTerminated(handle, "test: terminate an already-closed workflow");

          expect(outcome.terminated).toBe(false);
          expect(outcome.terminateError).toBeTruthy();
        },
      );
    });
  }, 30_000);

  it("reports not-terminated when the execution never reaches TERMINATED within the grace period", async () => {
    // Against the real server/SDK, terminate() applies essentially
    // synchronously — by the time describe() is called even once, the
    // execution already reads TERMINATED, so a real handle can't be made to
    // exercise the "ran out of grace period" branch by racing it. This is
    // exactly the kind of bounded-wait timeout logic that's this function's
    // own responsibility (not the SDK's), so it's tested with a minimal
    // stand-in matching just the two methods terminateAndAwaitTerminated
    // calls (terminate/describe) — not a mock of Temporal's SDK internals,
    // which CLAUDE.md's "Testing" section reserves the real
    // @temporalio/testing package for.
    const stuckHandle = {
      terminate: async () => {},
      describe: async () => ({ status: { name: "RUNNING" } }),
    } as unknown as Parameters<typeof terminateAndAwaitTerminated>[0];

    const outcome = await terminateAndAwaitTerminated(stuckHandle, "test: never observes TERMINATED", 300, 50);

    expect(outcome.terminateError).toBeNull();
    expect(outcome.terminated).toBe(false);
    expect(outcome.lastStatus).toBe("RUNNING");
  });
});
