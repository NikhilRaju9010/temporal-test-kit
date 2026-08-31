import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkI4TaskQueue } from "./i4.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkI4TaskQueue (real @temporalio/testing + sample project)", () => {
  it("passes when work started on the configured task queue is picked up there and work sent to a mismatched queue is not", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkI4TaskQueue(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("I4");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeNull();
  }, 30_000);
});
