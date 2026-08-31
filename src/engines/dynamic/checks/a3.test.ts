import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkA3DuplicateStart } from "./a3.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkA3DuplicateStart (real @temporalio/testing + sample project)", () => {
  it("passes when starting the same workflow ID twice is correctly rejected for the duplicate", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkA3DuplicateStart(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("A3");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/reject/i);
  }, 30_000);
});
