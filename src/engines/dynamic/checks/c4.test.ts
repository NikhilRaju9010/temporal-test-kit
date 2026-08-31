import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkC4UpdateWithStart } from "./c4.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkC4UpdateWithStart — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].updates when unset", async () => {
    const result = await checkC4UpdateWithStart(FAKE_ENV, baseTarget, { updateWithStart: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C4");
    expect(result.hint).toContain("workflows[].updates");
  });
});
