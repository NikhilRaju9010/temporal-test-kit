import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkC3UpdateValidation } from "./c3.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkC3UpdateValidation — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].updates when unset (N_A/feature-flag gating happens in the orchestrator, not here)", async () => {
    const result = await checkC3UpdateValidation(FAKE_ENV, baseTarget, { updates: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C3");
    expect(result.hint).toContain("workflows[].updates");
  });
});
