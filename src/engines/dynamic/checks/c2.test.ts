import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkC2Queries } from "./c2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkC2Queries — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].queries when unset", async () => {
    const result = await checkC2Queries(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C2");
    expect(result.hint).toContain("workflows[].queries");
  });
});
