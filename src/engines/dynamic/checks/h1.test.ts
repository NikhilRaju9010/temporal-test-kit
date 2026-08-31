import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkH1CancelRunsCleanup } from "./h1.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "InteractiveWorkflow", taskQueue: "interactive", workflowsPath: "/x", activities: {} };

describe("checkH1CancelRunsCleanup — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].hasCleanupOnCancel when unset", async () => {
    const result = await checkH1CancelRunsCleanup(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("H1");
    expect(result.hint).toContain("workflows[].hasCleanupOnCancel");
  });

  it("skips when hasCleanupOnCancel is explicitly false", async () => {
    const result = await checkH1CancelRunsCleanup(FAKE_ENV, { ...baseTarget, hasCleanupOnCancel: false }, {});
    expect(result.status).toBe("SKIPPED");
  });
});
