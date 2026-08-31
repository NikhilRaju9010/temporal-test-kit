import { describe, expect, it } from "vitest";
import { renderConsoleReport } from "./console-reporter.js";
import { TestResult, PreflightReport } from "./types.js";

const preflight: PreflightReport = {
  passed: true,
  results: [{ name: "config valid", passed: true, message: "ok" }],
  fatalMessage: null,
};

const results: TestResult[] = [
  { id: "X1", category: "Cat", name: "n", status: "PASS", target: null, message: "ok", hint: null, engine: "dynamic-zero-fixture" },
  { id: "X2", category: "Cat", name: "n", status: "FAIL", target: null, message: "bad", hint: "fix it", engine: "dynamic-zero-fixture" },
  { id: "X3", category: "Cat", name: "n", status: "SKIPPED", target: null, message: "no fixture", hint: "add fixture", engine: "dynamic-fixture" },
];

describe("renderConsoleReport", () => {
  it("includes a PREFLIGHT block when preflight passed", () => {
    const output = renderConsoleReport(preflight, results);
    expect(output).toMatch(/PREFLIGHT/);
  });

  it("shows the fatal message and skips test output when preflight has a fatal error", () => {
    const fatal: PreflightReport = {
      passed: false,
      results: [],
      fatalMessage: "Worker failed to start: boom",
    };
    const output = renderConsoleReport(fatal, []);
    expect(output).toMatch(/Worker failed to start: boom/);
  });

  it("prints the one-line overall summary with correct counts, including errored", () => {
    const output = renderConsoleReport(preflight, results);
    expect(output).toMatch(/Overall: 1 passed, 1 failed, 1 skipped, 0 not covered, 0 errored/);
  });

  it("shows a hint for FAIL and SKIPPED results", () => {
    const output = renderConsoleReport(preflight, results);
    expect(output).toMatch(/fix it/);
    expect(output).toMatch(/add fixture/);
  });

  it("shows ERRORED results with their hint, distinct from FAIL", () => {
    const withErrored: TestResult[] = [
      ...results,
      {
        id: "X4",
        category: "Cat",
        name: "n",
        status: "ERRORED",
        target: null,
        message: "threw",
        hint: "this is a tool bug, not an app finding",
        engine: "dynamic-zero-fixture",
      },
    ];
    const output = renderConsoleReport(preflight, withErrored);
    expect(output).toMatch(/\[ERRORED\]/);
    expect(output).toMatch(/this is a tool bug, not an app finding/);
    expect(output).toMatch(/Overall: 1 passed, 1 failed, 1 skipped, 0 not covered, 1 errored/);
  });
});
