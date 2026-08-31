import { describe, expect, it } from "vitest";
import { isFixtureMissing, missingFixtureResult } from "./require-fixture.js";

const base = {
  id: "B3",
  category: "Activities",
  name: "Retrying a step doesn't repeat its effect",
  target: "OrderWorkflow",
  engine: "dynamic-fixture" as const,
};

describe("isFixtureMissing", () => {
  it("treats undefined as missing", () => {
    expect(isFixtureMissing(undefined)).toBe(true);
  });

  it("treats null as missing", () => {
    expect(isFixtureMissing(null)).toBe(true);
  });

  it("treats an empty string as missing", () => {
    expect(isFixtureMissing("")).toBe(true);
  });

  it("treats an empty array as missing", () => {
    expect(isFixtureMissing([])).toBe(true);
  });

  it("does not treat a non-empty string as missing", () => {
    expect(isFixtureMissing("chargeCardActivity")).toBe(false);
  });

  it("does not treat a non-empty array as missing", () => {
    expect(isFixtureMissing([{ name: "cancelOrder", payload: {} }])).toBe(false);
  });

  it("does not treat false as missing (a real boolean fixture value)", () => {
    expect(isFixtureMissing(false)).toBe(false);
  });
});

describe("missingFixtureResult", () => {
  it("produces a SKIPPED result naming the exact config field in both message and hint", () => {
    const result = missingFixtureResult(base, "workflows[].idempotencyTestActivity");
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("B3");
    expect(result.message).toContain("workflows[].idempotencyTestActivity");
    expect(result.hint).toContain("workflows[].idempotencyTestActivity");
  });

  it("always includes a non-empty hint, satisfying ResultCollector's SKIPPED requirement", () => {
    const result = missingFixtureResult(base, "features.schedules");
    expect(result.hint).toBeTruthy();
  });
});
