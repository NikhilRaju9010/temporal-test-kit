import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkJ2SearchAttributes } from "./j2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkJ2SearchAttributes — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming features.customSearchAttributeKeys when unset", async () => {
    const result = await checkJ2SearchAttributes(FAKE_ENV, baseTarget, { searchAttributes: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("J2");
    expect(result.hint).toContain("features.customSearchAttributeKeys");
  });
});
