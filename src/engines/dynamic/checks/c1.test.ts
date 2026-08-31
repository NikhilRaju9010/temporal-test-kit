import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkC1Signals } from "./c1.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkC1Signals — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].signals when unset", async () => {
    const result = await checkC1Signals(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C1");
    expect(result.hint).toContain("workflows[].signals");
  });

  it("skips when signals is an empty array", async () => {
    const result = await checkC1Signals(FAKE_ENV, { ...baseTarget, signals: [] }, {});
    expect(result.status).toBe("SKIPPED");
  });
});
