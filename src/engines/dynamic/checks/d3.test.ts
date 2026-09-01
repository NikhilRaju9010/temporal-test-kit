import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkD3OverlappingSchedules } from "./d3.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkD3OverlappingSchedules — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming features.scheduleWorkflowId when unset", async () => {
    const result = await checkD3OverlappingSchedules(FAKE_ENV, baseTarget, { schedules: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("D3");
    expect(result.hint).toContain("features.scheduleWorkflowId");
  });
});

describe("checkD3OverlappingSchedules — SKIPPED for workflows other than features.scheduleWorkflowId", () => {
  it("skips without touching env when target.type doesn't match", async () => {
    const result = await checkD3OverlappingSchedules(FAKE_ENV, baseTarget, {
      schedules: true,
      scheduleWorkflowId: "SomeOtherWorkflow",
    });
    expect(result.status).toBe("SKIPPED");
    expect(result.message).toContain("SomeOtherWorkflow");
    expect(result.hint).toContain("features.scheduleWorkflowId");
  });
});

describe("checkD3OverlappingSchedules (real @temporalio/testing + sample project's GreetingWorkflow)", () => {
  it("forces an overlap (no worker) and confirms SKIP lets exactly one action run, correctly skipping the rest", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkD3OverlappingSchedules(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-d3-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
        },
        { schedules: true, scheduleWorkflowId: "GreetingWorkflow" },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("D3");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/SKIP/);
  }, 40_000);
});
