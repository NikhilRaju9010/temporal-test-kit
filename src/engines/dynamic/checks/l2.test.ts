import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkL2DependencyOutageRecovery } from "./l2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkL2DependencyOutageRecovery — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].dependencyOutageTestActivity when unset", async () => {
    const result = await checkL2DependencyOutageRecovery(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("L2");
    expect(result.hint).toContain("workflows[].dependencyOutageTestActivity");
  });
});
