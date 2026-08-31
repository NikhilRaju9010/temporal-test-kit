import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkJ3FailureMessages } from "./j3.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");
const GENERIC_FAILURE_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "j3-generic-failure-workflow.ts");
const DESCRIPTIVE_FAILURE_WORKFLOWS_PATH = join(
  import.meta.dirname,
  "fixtures",
  "j3-descriptive-failure-workflow.ts",
);

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkJ3FailureMessages (real @temporalio/testing + sample project)", () => {
  it("SKIPPEDs when the zero-fixture run completes successfully instead of failing (GreetingWorkflow against sample project)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkJ3FailureMessages(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("J3");
    expect(result.category).toBe("Observability");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeTruthy();
    expect(result.hint).toMatch(/sampleInput|fixture/i);
  }, 30_000);

  it("fails when the workflow fails with a generic, useless error message", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkJ3FailureMessages(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: GENERIC_FAILURE_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("FAIL");
    expect(result.id).toBe("J3");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeTruthy();
  }, 30_000);

  it("passes when the workflow fails with a specific, descriptive error message", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkJ3FailureMessages(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: DESCRIPTIVE_FAILURE_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("J3");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/initialName is required/);
  }, 30_000);
});
