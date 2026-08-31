import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { createEphemeralEnvironment } from "./environment.js";
import { spawnKillableWorker } from "./child-worker.js";
import { generateWorkflowId } from "./workflow-id.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");
const ACTIVITIES_PATH = join(SAMPLE_PROJECT, "src", "activities.ts");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("spawnKillableWorker (real OS child process)", () => {
  it("boots a real child-process worker that actually executes a workflow against the sample project", async () => {
    const env = await createEphemeralEnvironment();
    try {
      const child = await spawnKillableWorker(env, {
        taskQueue: "ttk-child-worker-test",
        workflowsPath: WORKFLOWS_PATH,
        activitiesPath: ACTIVITIES_PATH,
      });

      try {
        expect(isProcessAlive(child.pid)).toBe(true);

        const handle = await env.client.workflow.start("GreetingWorkflow", {
          taskQueue: "ttk-child-worker-test",
          workflowId: generateWorkflowId("CHILD-WORKER-TEST", "GreetingWorkflow"),
          args: ["World"],
        });
        const result = await handle.result();
        expect(result).toBe("Hello, World!");
      } finally {
        await child.kill();
      }

      // Reaped, not a zombie: kill(pid, 0) throws ESRCH only once the OS has
      // no record of the pid left at all (a zombie still answers this call).
      expect(isProcessAlive(child.pid)).toBe(false);
    } finally {
      await env.teardown();
    }
  }, 30_000);

  it("kill() is safe to call twice", async () => {
    const env = await createEphemeralEnvironment();
    try {
      const child = await spawnKillableWorker(env, {
        taskQueue: "ttk-child-worker-test-2",
        workflowsPath: WORKFLOWS_PATH,
        activitiesPath: ACTIVITIES_PATH,
      });

      await child.kill();
      await expect(child.kill()).resolves.not.toThrow();
    } finally {
      await env.teardown();
    }
  }, 30_000);

  it("rejects with a clear error if the child process fails to boot (bad activities path), instead of hanging", async () => {
    const env = await createEphemeralEnvironment();
    try {
      await expect(
        spawnKillableWorker(env, {
          taskQueue: "ttk-child-worker-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activitiesPath: join(SAMPLE_PROJECT, "src", "does-not-exist.ts"),
        }),
      ).rejects.toThrow();
    } finally {
      await env.teardown();
    }
  }, 30_000);
});
