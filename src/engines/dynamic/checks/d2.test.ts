import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkD2SchedulesFireOnTime } from "./d2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkD2SchedulesFireOnTime — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming features.scheduleWorkflowId when unset", async () => {
    const result = await checkD2SchedulesFireOnTime(FAKE_ENV, baseTarget, { schedules: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("D2");
    expect(result.hint).toContain("features.scheduleWorkflowId");
  });
});
