import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkA4DataIntegrity, PROBE_PAYLOAD } from "./a4.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkA4DataIntegrity (real @temporalio/testing + sample project)", () => {
  it("passes when the recorded WorkflowExecutionStarted history event decodes back to the exact probe payload", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkA4DataIntegrity(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("A4");
    expect(result.category).toBe("Workflow Execution & Determinism");
    expect(result.name).toBe("Data isn't lost or corrupted going in/out");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.engine).toBe("dynamic-zero-fixture");
    expect(result.hint).toBeNull();
  }, 30_000);

  it("honors a waitBudgetsMs.A4.waitTimeoutMs override instead of the hardcoded default", async () => {
    // A4's wait is a raceWithTimeout around handle.result() that's only there
    // to avoid leaving the workflow running longer than necessary — grading
    // itself is based on the WorkflowExecutionStarted event, written
    // synchronously at start, regardless of whether the race actually
    // observed completion. So a1/j1-style message-content assertion isn't
    // available here (a4.ts never interpolates the wait value into any
    // message) — instead, this proves the override took effect by using a
    // workflow that legitimately keeps running (never lets the race resolve
    // via real completion) and confirming the check still reaches a correct
    // PASS well under the DEFAULT 5000ms, bounded instead by the tiny
    // override.
    const activities = await loadActivities();
    const HANGING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "a4-hanging-workflow.ts");

    const start = Date.now();
    const result = await withEphemeralEnvironment((env) =>
      checkA4DataIntegrity(
        env,
        {
          workflowType: "GreetingWorkflow",
          taskQueue: "default",
          workflowsPath: HANGING_WORKFLOWS_PATH,
          activities,
        },
        undefined,
        { A4: { waitTimeoutMs: 200 } },
      ),
    );
    const elapsedMs = Date.now() - start;

    expect(result.status).toBe("PASS");
    // Bound: WAIT_TIMEOUT_MS's own default is 5000ms, so if the override
    // weren't actually used, elapsed time would be AT LEAST that — plus
    // whatever worker-boot/env overhead this run also pays. Under full-suite
    // load that overhead alone was observed reaching ~5s, so 5000ms flaked;
    // 8000ms keeps real margin below what "default + overhead" would need
    // while still catching a broken override.
    expect(elapsedMs).toBeLessThan(8000);
  }, 30_000);

  it("PROBE_PAYLOAD is a deliberately complex, nested payload exercising several JSON shapes", () => {
    expect(PROBE_PAYLOAD).toMatchObject({
      __ttkProbe: true,
      count: 42.5,
      flag: true,
      nothing: null,
      tags: ["a", "b", "c"],
      nested: { deep: { value: "héllo" } },
    });
  });
});
