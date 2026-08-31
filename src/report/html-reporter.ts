import { PreflightReport, TestResult, Status } from "./types.js";
import { ResultCollector } from "./collect.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATUS_COLORS: Record<Status, string> = {
  PASS: "#1a7f37",
  FAIL: "#cf222e",
  SKIPPED: "#9a6700",
  N_A: "#57606a",
  NOT_COVERED: "#57606a",
  ERRORED: "#8250df",
};

function pill(status: Status): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;color:#fff;background:${STATUS_COLORS[status]};font-size:12px;">${status}</span>`;
}

export function renderHtmlReport(preflight: PreflightReport, results: TestResult[]): string {
  const collector = new ResultCollector();
  for (const r of results) collector.add(r);
  const summary = collector.summary();

  const preflightHtml = preflight.fatalMessage
    ? `<p style="color:${STATUS_COLORS.FAIL};font-weight:bold;">FATAL: ${esc(preflight.fatalMessage)}</p>`
    : `<ul>${preflight.results
        .map((r) => `<li>${r.passed ? "✓" : "✗"} ${esc(r.name)}: ${esc(r.message)}</li>`)
        .join("")}</ul>`;

  const byCategory = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r);
  }

  const categoriesHtml = Array.from(byCategory.entries())
    .map(([category, group]) => {
      const rows = group
        .map(
          (r) => `<div style="padding:8px;border-bottom:1px solid #d0d7de;">
        <div><strong>${esc(r.id)}</strong> ${esc(r.name)} ${pill(r.status)}</div>
        <div>${esc(r.message)}</div>
        ${r.hint ? `<div style="color:#57606a;">hint: ${esc(r.hint)}</div>` : ""}
      </div>`,
        )
        .join("");
      return `<details open style="margin-bottom:12px;">
        <summary style="font-weight:bold;cursor:pointer;">${esc(category)}</summary>
        ${rows}
      </details>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>temporal-test-kit report</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 24px; color: #1f2328; }
  h1 { font-size: 20px; }
</style>
</head>
<body>
<h1>temporal-test-kit report</h1>
<h2>Preflight</h2>
${preflightHtml}
<h2>Results</h2>
${categoriesHtml}
<h2>Summary</h2>
<p>Overall: ${summary.PASS} passed, ${summary.FAIL} failed, ${summary.SKIPPED} skipped, ${summary.N_A} n/a, ${summary.NOT_COVERED} not covered, ${summary.ERRORED} errored</p>
</body>
</html>`;
}
