import { describe, expect, it } from "vitest";
import { ResultCollector } from "./collect.js";

const base = {
  id: "X1",
  category: "Test",
  name: "Some check",
  target: null,
  engine: "dynamic-zero-fixture" as const,
};

describe("ResultCollector", () => {
  it("accepts a PASS result with no hint", () => {
    const collector = new ResultCollector();
    collector.add({ ...base, status: "PASS", message: "ok", hint: null });
    expect(collector.results).toHaveLength(1);
  });

  it("throws when adding a FAIL result with no hint", () => {
    const collector = new ResultCollector();
    expect(() =>
      collector.add({ ...base, status: "FAIL", message: "broke", hint: null }),
    ).toThrow(/hint/i);
  });

  it("throws when adding a SKIPPED result with an empty-string hint", () => {
    const collector = new ResultCollector();
    expect(() =>
      collector.add({ ...base, status: "SKIPPED", message: "no fixture", hint: "" }),
    ).toThrow(/hint/i);
  });

  it("throws when adding an ERRORED result with no hint", () => {
    const collector = new ResultCollector();
    expect(() =>
      collector.add({ ...base, status: "ERRORED", message: "threw", hint: null }),
    ).toThrow(/hint/i);
  });

  it("computes a summary count per status", () => {
    const collector = new ResultCollector();
    collector.add({ ...base, id: "X1", status: "PASS", message: "ok", hint: null });
    collector.add({ ...base, id: "X2", status: "FAIL", message: "bad", hint: "fix it" });
    collector.add({ ...base, id: "X3", status: "NOT_COVERED", message: "n/a here", hint: null });
    collector.add({ ...base, id: "X4", status: "ERRORED", message: "threw", hint: "investigate" });

    expect(collector.summary()).toEqual({
      PASS: 1,
      FAIL: 1,
      SKIPPED: 0,
      N_A: 0,
      NOT_COVERED: 1,
      ERRORED: 1,
    });
  });
});
