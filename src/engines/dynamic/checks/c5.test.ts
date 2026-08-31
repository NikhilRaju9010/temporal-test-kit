import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkC5NoStuckOnSignalUpdate } from "./c5.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkC5NoStuckOnSignalUpdate — SKIPPED when its fixture is missing", () => {
  it("skips when neither signals nor updates are configured", async () => {
    const result = await checkC5NoStuckOnSignalUpdate(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C5");
    expect(result.hint).toMatch(/workflows\[\]\.(signals|updates)/);
  });
});
