import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkB4Heartbeats, LONG_ACTIVITY_THRESHOLD_MS, recordActivityExecutions } from "./b4.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");
const LONG_WORKFLOWS_PATH = join(import.meta.dirname, "fixtures", "b4-long-workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

async function loadB4Activities() {
  return import(join(import.meta.dirname, "fixtures", "b4-activities.ts"));
}

describe("checkB4Heartbeats (real @temporalio/testing + sample project)", () => {
  it(
    "passes with an honest 'nothing meaningful to grade' message when every activity completes fast " +
      "(GreetingWorkflow against sample project — formatGreetingActivity runs near-instantly)",
    async () => {
      const activities = await loadActivities();

      const result = await withEphemeralEnvironment((env) =>
        checkB4Heartbeats(env, {
          workflowType: "GreetingWorkflow",
          taskQueue: "default",
          workflowsPath: WORKFLOWS_PATH,
          activities,
        }),
      );

      expect(result.status).toBe("PASS");
      expect(result.id).toBe("B4");
      expect(result.category).toBe("Activities");
      expect(result.name).toBe("Long steps send heartbeats");
      expect(result.target).toBe("GreetingWorkflow");
      expect(result.hint).toBeNull();
      expect(result.message).toMatch(/no activity ran long enough/i);
      expect(result.message).toMatch(/fixture/i);
    },
    30_000,
  );

  it(
    "recordActivityExecutions measures a real duration for formatGreetingActivity, and it lands under " +
      "the long-activity threshold",
    async () => {
      const activities = await loadActivities();

      await withEphemeralEnvironment(async (env) => {
        const recorded = await recordActivityExecutions(env, {
          workflowType: "GreetingWorkflow",
          taskQueue: "default",
          workflowsPath: WORKFLOWS_PATH,
          activities,
        });

        expect(recorded.activities.length).toBeGreaterThan(0);
        const activity = recorded.activities.find((a) => a.activityType === "formatGreetingActivity");
        expect(activity).toBeDefined();
        expect(activity!.outcome).toBe("COMPLETED");
        expect(activity!.durationMs).not.toBeNull();
        expect(activity!.durationMs as number).toBeLessThan(LONG_ACTIVITY_THRESHOLD_MS);
        expect(activity!.heartbeatSeenLive).toBe(false);
      });
    },
    30_000,
  );

  it(
    "fails with a heartbeat hint when a long-running activity never calls heartbeat()",
    async () => {
      const b4Activities = await loadB4Activities();

      const result = await withEphemeralEnvironment((env) =>
        checkB4Heartbeats(env, {
          workflowType: "B4WorkflowWithoutHeartbeat",
          taskQueue: "default",
          workflowsPath: LONG_WORKFLOWS_PATH,
          activities: b4Activities,
        }),
      );

      expect(result.status).toBe("FAIL");
      expect(result.id).toBe("B4");
      expect(result.target).toBe("B4WorkflowWithoutHeartbeat");
      expect(result.hint).toBeTruthy();
      expect(result.hint).toMatch(/heartbeat/i);
      expect(result.message).toMatch(/without recording any heartbeat/i);
    },
    30_000,
  );

  it(
    "passes when a long-running activity heartbeats throughout its execution",
    async () => {
      const b4Activities = await loadB4Activities();

      const result = await withEphemeralEnvironment((env) =>
        checkB4Heartbeats(env, {
          workflowType: "B4WorkflowWithHeartbeat",
          taskQueue: "default",
          workflowsPath: LONG_WORKFLOWS_PATH,
          activities: b4Activities,
        }),
      );

      expect(result.status).toBe("PASS");
      expect(result.id).toBe("B4");
      expect(result.target).toBe("B4WorkflowWithHeartbeat");
      expect(result.hint).toBeNull();
      expect(result.message).toMatch(/recorded heartbeats/i);
    },
    30_000,
  );

  it(
    "honors a waitBudgetsMs.B4.runTimeoutMs override instead of the hardcoded default",
    async () => {
      // Uses recordActivityExecutions directly against
      // b4SleepWithHeartbeatActivity, which genuinely sleeps for 3 real
      // seconds. Timing alone can't prove this: withRunningWorker's
      // graceful shutdown waits for whatever activity is already in flight
      // regardless of the race's own outcome, so total elapsed time stays
      // dominated by the activity's real duration either way. What DOES
      // prove the override was honored is the recorded OUTCOME: a 500ms
      // override means fetchHistory() runs long before the activity's real
      // ActivityTaskCompleted event exists (3s away), recording STARTED
      // with no measured duration — not the default's accurately-measured
      // COMPLETED the sibling test above gets with the full 10000ms budget.
      const b4Activities = await loadB4Activities();

      const recorded = await withEphemeralEnvironment((env) =>
        recordActivityExecutions(
          env,
          {
            workflowType: "B4WorkflowWithHeartbeat",
            taskQueue: "default",
            workflowsPath: LONG_WORKFLOWS_PATH,
            activities: b4Activities,
          },
          undefined,
          500,
        ),
      );

      const activity = recorded.activities.find((a) => a.activityType === "b4SleepWithHeartbeatActivity");
      expect(activity).toBeDefined();
      // UNSTARTED (scheduled, not yet dispatched) or STARTED (dispatched,
      // not yet complete) are both valid evidence the override cut recording
      // short — either way, definitively not the default's COMPLETED.
      expect(["UNSTARTED", "STARTED"]).toContain(activity!.outcome);
      expect(activity!.durationMs).toBeNull();
    },
    30_000,
  );
});
