import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkI3Replay, recordWorkflowHistory, replayHistory } from "./i3.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");
const NONDETERMINISTIC_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "nondeterministic-workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkI3Replay (real @temporalio/testing + sample project)", () => {
  it("passes when the current workflow code replays its own history without errors", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkI3Replay(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("I3");
    expect(result.target).toBe("GreetingWorkflow");
    expect(result.hint).toBeNull();
  }, 30_000);

  it("replayHistory fails with a nondeterminism error when code changed structurally since the history was recorded", async () => {
    const activities = await loadActivities();

    await withEphemeralEnvironment(async (env) => {
      const { history, workflowId } = await recordWorkflowHistory(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      });

      const replayed = await replayHistory(NONDETERMINISTIC_WORKFLOWS_PATH, history, workflowId);

      expect(replayed.ok).toBe(false);
      expect(replayed.error).toBeTruthy();
    });
  }, 30_000);
});
