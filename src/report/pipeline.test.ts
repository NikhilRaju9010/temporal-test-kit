import { describe, expect, it } from "vitest";
import { renderConsoleReport } from "./console-reporter.js";
import { renderHtmlReport } from "./html-reporter.js";
import { runFakeCheck } from "../engines/dynamic/checks/_fake.js";
import { CATALOG } from "../catalog.js";
import { PreflightReport, TestResult } from "./types.js";

/**
 * Phase 2a proof: the report pipeline (collector + both reporters) correctly
 * renders all five result statuses end-to-end, driven by the trivial fake
 * check (forced to each status) plus real NOT_COVERED rows from the catalog.
 */
describe("report pipeline end-to-end (all five statuses)", () => {
  const preflight: PreflightReport = {
    passed: true,
    results: [{ name: "config valid", passed: true, message: "ok" }],
    fatalMessage: null,
  };

  const notCoveredEntry = CATALOG.find((c) => c.engine === "not-covered")!;
  const skippedResult: TestResult = {
    id: "SK1",
    category: "Fake",
    name: "Fixture-gated fake check",
    status: "SKIPPED",
    target: null,
    message: "Missing fixture data",
    hint: "Add workflows[0].sampleInput to unlock this check.",
    engine: "dynamic-fixture",
  };
  const naResult: TestResult = {
    id: "NA1",
    category: "Fake",
    name: "Feature-gated fake check",
    status: "N_A",
    target: null,
    message: "Project doesn't use this feature",
    hint: null,
    engine: "dynamic-fixture",
  };

  const results: TestResult[] = [
    runFakeCheck("PASS"),
    runFakeCheck("FAIL"),
    skippedResult,
    naResult,
    {
      id: notCoveredEntry.id,
      category: notCoveredEntry.category,
      name: notCoveredEntry.name,
      status: "NOT_COVERED",
      target: null,
      message: "Requires real staging/multi-node/chaos infrastructure.",
      hint: null,
      engine: "dynamic-zero-fixture",
    },
  ];

  it("console report shows all five statuses", () => {
    const output = renderConsoleReport(preflight, results);
    expect(output).toMatch(/\[PASS\]/);
    expect(output).toMatch(/\[FAIL\]/);
    expect(output).toMatch(/\[SKIPPED\]/);
    expect(output).toMatch(/\[N_A\]/);
    expect(output).toMatch(/\[NOT_COVERED\]/);
    expect(output).toContain(notCoveredEntry.id);
  });

  it("html report shows all five statuses as pills", () => {
    const html = renderHtmlReport(preflight, results);
    for (const status of ["PASS", "FAIL", "SKIPPED", "N_A", "NOT_COVERED"]) {
      expect(html).toContain(`>${status}<`);
    }
  });

  it("summary counts every status exactly once where expected", () => {
    const output = renderConsoleReport(preflight, results);
    expect(output).toMatch(/Overall: 1 passed, 1 failed, 1 skipped, 1 not covered/);
  });
});
