import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkB5CancellationStops } from "./b5.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");
const HANGING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "b5-hanging-workflow.ts");
const SWALLOWING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "b5-swallowing-workflow.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkB5CancellationStops (real @temporalio/testing, no mocked Temporal internals)", () => {
  it("passes when a workflow that doesn't shield itself reaches CANCELLED promptly", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkB5CancellationStops(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: HANGING_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("B5");
    expect(result.category).toBe("Activities");
    expect(result.name).toBe("Cancelling a step actually stops it");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/cancel/i);
  }, 30_000);

  it("fails when a workflow shields itself from cancellation (nonCancellable) and keeps running", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkB5CancellationStops(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: SWALLOWING_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("FAIL");
    expect(result.id).toBe("B5");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeTruthy();
    expect(result.hint).toMatch(/orphan|swallow|catch|cancel/i);
    expect(result.message).toMatch(/running|did not|not.*honor/i);
  }, 30_000);

  it("does not error out against the real sample project even though GreetingWorkflow can complete near-instantly", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkB5CancellationStops(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    // Whichever way the race against the sample project's near-instant
    // workflow lands, the check itself must resolve cleanly to a real
    // status rather than throwing/hanging.
    expect(["PASS", "FAIL"]).toContain(result.status);
    expect(result.id).toBe("B5");
    expect(result.target).toBe("GreetingWorkflow");
  }, 30_000);

  it("honors a waitBudgetsMs.B5.gracePeriodMs override instead of the hardcoded default", async () => {
    const activities = await loadActivities();

    const start = Date.now();
    const result = await withEphemeralEnvironment((env) =>
      checkB5CancellationStops(
        env,
        {
          workflowType: "GreetingWorkflow",
          taskQueue: "default",
          workflowsPath: SWALLOWING_WORKFLOWS_PATH,
          activities,
        },
        undefined,
        { B5: { gracePeriodMs: 300 } },
      ),
    );
    const elapsedMs = Date.now() - start;

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/300ms/);
    // Bound: GRACE_PERIOD_MS's own default is 5000ms (doubled, even, since
    // this check can race the wait twice in its fallback path), plus
    // worker-boot/env overhead — under full-suite load that overhead alone
    // was observed reaching ~5s, so 5000ms flaked; 8000ms keeps real margin
    // below what "default + overhead" would need.
    expect(elapsedMs).toBeLessThan(8000);
  }, 30_000);
});

const MISSING_INPUT_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "missing-input-workflows.ts");

describe("checkB5CancellationStops — distinguishing a missing-argument crash from a genuine cancellation failure", () => {
  it("appends a missing-argument note (direct property access) but keeps status FAIL, not a silent reclassification", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkB5CancellationStops(env, {
        workflowType: "RequiresInputWorkflow",
        taskQueue: "default",
        workflowsPath: MISSING_INPUT_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/did not honor the cancellation request/i);
    expect(result.message).toMatch(/missing-argument crash/i);
    expect(result.message).toContain("Cannot read properties of undefined (reading 'foo')");
  }, 30_000);

  it("also recognizes the destructured-parameter crash shape, not just direct property access", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkB5CancellationStops(env, {
        workflowType: "RequiresDestructuredInputWorkflow",
        taskQueue: "default",
        workflowsPath: MISSING_INPUT_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/missing-argument crash/i);
    expect(result.message).toContain("Cannot destructure property");
  }, 30_000);

  it("NEGATIVE CONTROL: does NOT append the missing-argument note for an unrelated crash that looks structurally identical (zero completed tasks either way)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkB5CancellationStops(env, {
        workflowType: "AlwaysCrashesWorkflow",
        taskQueue: "default",
        workflowsPath: MISSING_INPUT_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/did not honor the cancellation request/i);
    expect(result.message).not.toMatch(/missing-argument crash/i);
  }, 30_000);
});
