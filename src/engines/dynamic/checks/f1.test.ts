import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkF1FailingChildHandled } from "./f1.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "ParentWorkflow", taskQueue: "parent", workflowsPath: "/x", activities: {} };

describe("checkF1FailingChildHandled — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].hasChildWorkflows when unset", async () => {
    const result = await checkF1FailingChildHandled(FAKE_ENV, baseTarget, { childWorkflows: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("F1");
    expect(result.hint).toContain("workflows[].hasChildWorkflows");
  });

  it("skips when hasChildWorkflows is explicitly false", async () => {
    const result = await checkF1FailingChildHandled(FAKE_ENV, { ...baseTarget, hasChildWorkflows: false }, { childWorkflows: true });
    expect(result.status).toBe("SKIPPED");
  });
});
