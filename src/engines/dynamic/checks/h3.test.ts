import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkH3CancelParentHandlesChildren } from "./h3.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "ParentWorkflow", taskQueue: "parent", workflowsPath: "/x", activities: {} };

describe("checkH3CancelParentHandlesChildren — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].hasChildWorkflows when unset", async () => {
    const result = await checkH3CancelParentHandlesChildren(FAKE_ENV, baseTarget, { childWorkflows: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("H3");
    expect(result.hint).toContain("workflows[].hasChildWorkflows");
  });
});
