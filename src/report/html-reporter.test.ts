import { describe, expect, it } from "vitest";
import { renderHtmlReport } from "./html-reporter.js";
import { TestResult, PreflightReport } from "./types.js";

const preflight: PreflightReport = {
  passed: true,
  results: [{ name: "config valid", passed: true, message: "ok" }],
  fatalMessage: null,
};

const results: TestResult[] = [
  { id: "X1", category: "Cat", name: "n", status: "PASS", target: null, message: "ok", hint: null, engine: "dynamic-zero-fixture" },
  { id: "X2", category: "Cat", name: "n", status: "FAIL", target: null, message: "bad", hint: "fix it now", engine: "dynamic-zero-fixture" },
];

describe("renderHtmlReport", () => {
  it("produces a single self-contained HTML document", () => {
    const html = renderHtmlReport(preflight, results);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).not.toMatch(/<link\s+rel="stylesheet"/);
    expect(html).not.toMatch(/<script\s+src=/);
  });

  it("includes each result id and its hint text inline", () => {
    const html = renderHtmlReport(preflight, results);
    expect(html).toContain("X1");
    expect(html).toContain("X2");
    expect(html).toContain("fix it now");
  });

  it("escapes HTML-unsafe characters in messages", () => {
    const unsafe: TestResult[] = [
      { id: "X3", category: "Cat", name: "n", status: "FAIL", target: null, message: "<script>alert(1)</script>", hint: "escape it", engine: "dynamic-zero-fixture" },
    ];
    const html = renderHtmlReport(preflight, unsafe);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
