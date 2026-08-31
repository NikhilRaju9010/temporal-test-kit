import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkE2ContinueAsNewStatePreserved } from "./e2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "CounterWorkflow", taskQueue: "counter", workflowsPath: "/x", activities: {} };

describe("checkE2ContinueAsNewStatePreserved — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].isLongRunning when unset", async () => {
    const result = await checkE2ContinueAsNewStatePreserved(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("E2");
    expect(result.hint).toContain("workflows[].isLongRunning");
  });

  it("skips when isLongRunning is explicitly false", async () => {
    const result = await checkE2ContinueAsNewStatePreserved(FAKE_ENV, { ...baseTarget, isLongRunning: false }, {});
    expect(result.status).toBe("SKIPPED");
  });
});
