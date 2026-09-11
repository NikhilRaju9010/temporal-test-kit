import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkA1WorkflowStarts } from "./a1.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");
const HANGING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "a1-hanging-workflow.ts");
const FAILING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "a1-failing-workflow.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkA1WorkflowStarts (real @temporalio/testing + sample project)", () => {
  it("passes when the workflow completes even with no args (GreetingWorkflow against sample project)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkA1WorkflowStarts(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("A1");
    expect(result.category).toBe("Workflow Execution & Determinism");
    expect(result.name).toBe("Workflow starts and runs correctly");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/completed/i);
  }, 30_000);

  it("fails when the workflow errors out, with a hint noting this may be missing business input", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkA1WorkflowStarts(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: FAILING_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("FAIL");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeTruthy();
    expect(result.hint).toMatch(/sampleInput|input/i);
  }, 30_000);

  it("fails as still-RUNNING when the workflow never reaches a terminal state within the internal wait", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkA1WorkflowStarts(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: HANGING_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("FAIL");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeTruthy();
    expect(result.hint).toMatch(/signal|quer(y|ies)|running/i);
    expect(result.message).toMatch(/running/i);
  }, 30_000);

  it("honors a waitBudgetsMs.A1.waitTimeoutMs override instead of the hardcoded default", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkA1WorkflowStarts(
        env,
        {
          workflowType: "GreetingWorkflow",
          taskQueue: "default",
          workflowsPath: HANGING_WORKFLOWS_PATH,
          activities,
        },
        undefined,
        { A1: { waitTimeoutMs: 500 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/500ms/);
  }, 30_000);
});

const MISSING_INPUT_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "missing-input-workflows.ts");

describe("checkA1WorkflowStarts — distinguishing a missing-argument crash from a genuine hang", () => {
  it("appends a missing-argument note (direct property access) but keeps status FAIL, not a silent reclassification", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkA1WorkflowStarts(env, {
        workflowType: "RequiresInputWorkflow",
        taskQueue: "default",
        workflowsPath: MISSING_INPUT_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/still RUNNING/i);
    expect(result.message).toMatch(/missing-argument crash/i);
    expect(result.message).toContain("Cannot read properties of undefined (reading 'foo')");
  }, 30_000);

  it("also recognizes the destructured-parameter crash shape, not just direct property access", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkA1WorkflowStarts(env, {
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
      checkA1WorkflowStarts(env, {
        workflowType: "AlwaysCrashesWorkflow",
        taskQueue: "default",
        workflowsPath: MISSING_INPUT_WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/still RUNNING/i);
    expect(result.message).not.toMatch(/missing-argument crash/i);
  }, 30_000);
});
