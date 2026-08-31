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
