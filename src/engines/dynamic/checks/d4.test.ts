import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkD4MissedSchedules } from "./d4.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkD4MissedSchedules — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming features.scheduleWorkflowId when unset", async () => {
    const result = await checkD4MissedSchedules(FAKE_ENV, baseTarget, { schedules: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("D4");
    expect(result.hint).toContain("features.scheduleWorkflowId");
  });
});

describe("checkD4MissedSchedules — SKIPPED for workflows other than features.scheduleWorkflowId", () => {
  it("skips without touching env when target.type doesn't match", async () => {
    const result = await checkD4MissedSchedules(FAKE_ENV, baseTarget, {
      schedules: true,
      scheduleWorkflowId: "SomeOtherWorkflow",
    });
    expect(result.status).toBe("SKIPPED");
    expect(result.message).toContain("SomeOtherWorkflow");
    expect(result.hint).toContain("features.scheduleWorkflowId");
  });
});

describe("checkD4MissedSchedules (real @temporalio/testing + sample project's GreetingWorkflow)", () => {
  it("backfills a simulated downtime window and confirms multiple missed occurrences are caught up on, not dropped", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkD4MissedSchedules(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-d4-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
        },
        { schedules: true, scheduleWorkflowId: "GreetingWorkflow" },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("D4");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/backfilling/i);
  }, 30_000);
});
