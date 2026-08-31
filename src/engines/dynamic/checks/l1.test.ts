import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkL1ConnectionLossRecovery } from "./l1.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkL1ConnectionLossRecovery (real @temporalio/testing, narrow connection-loss scope)", () => {
  it("closes the worker's connection mid-workflow, reconnects with a fresh connection + worker, and confirms the workflow resumes and completes", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkL1ConnectionLossRecovery(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("L1");
    expect(result.engine).toBe("dynamic-zero-fixture");
    // Honesty requirement: this check's scope is narrower than its catalog
    // name ("Temporal Server outage recovery") implies — no local API exists
    // to pause/resume the embedded test server itself, so this only proves
    // SDK/connection-level reconnection, not survival of the server actually
    // going down. Both target and message must say so explicitly, never
    // implying broader coverage than what's actually tested.
    expect(result.target).toMatch(/connection.loss only, not (a )?full server outage/i);
    expect(result.message).toMatch(/connection.loss|dropped connection|reconnect/i);
    expect(result.message).toMatch(/not.*(server outage|server.*down)/i);
    expect(result.hint).toBeNull();
  }, 30_000);
});
