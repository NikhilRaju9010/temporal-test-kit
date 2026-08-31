import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkK2SensitiveDataNotExposed } from "./k2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "SagaWorkflow", taskQueue: "saga", workflowsPath: "/x", activities: {} };

describe("checkK2SensitiveDataNotExposed — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].sensitiveDataFields when unset", async () => {
    const result = await checkK2SensitiveDataNotExposed(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("K2");
    expect(result.hint).toContain("workflows[].sensitiveDataFields");
  });
});
