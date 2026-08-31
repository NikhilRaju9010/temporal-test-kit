import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkD3OverlappingSchedules } from "./d3.js";

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
