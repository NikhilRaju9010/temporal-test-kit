import { describe, expect, it } from "vitest";
import { EphemeralEnvironment } from "../environment.js";
import { checkB3Idempotency } from "./b3.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

describe("checkB3Idempotency — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].idempotencyTestActivity when unset", async () => {
    const result = await checkB3Idempotency(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("B3");
    expect(result.hint).toContain("workflows[].idempotencyTestActivity");
  });
});
