import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkJ1EventHistory } from "./j1.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");
const HANGING_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "j1-hanging-workflow.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkJ1EventHistory (real @temporalio/testing + sample project)", () => {
  it("passes when the workflow completes and its history starts with STARTED and ends with a coherent COMPLETED event", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkJ1EventHistory(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("J1");
    expect(result.category).toBe("Observability");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/WorkflowExecutionCompleted/);
  }, 30_000);

  it("honors a waitBudgetsMs.J1.waitTimeoutMs override instead of the hardcoded default", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkJ1EventHistory(
        env,
        {
          workflowType: "GreetingWorkflow",
          taskQueue: "default",
          workflowsPath: HANGING_WORKFLOWS_PATH,
          activities,
        },
        undefined,
        { J1: { waitTimeoutMs: 500 } },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.message).toMatch(/500ms/);
  }, 30_000);
});
