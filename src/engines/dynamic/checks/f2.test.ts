import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkF2ChildNotOrphaned } from "./f2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "ParentWorkflow", taskQueue: "parent", workflowsPath: "/x", activities: {} };

describe("checkF2ChildNotOrphaned — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].hasChildWorkflows when unset", async () => {
    const result = await checkF2ChildNotOrphaned(FAKE_ENV, baseTarget, { childWorkflows: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("F2");
    expect(result.hint).toContain("workflows[].hasChildWorkflows");
  });
});
