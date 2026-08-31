import { PreflightReport, Status, TestResult } from "./types.js";
import { ResultCollector } from "./collect.js";

function engineLabel(engine: TestResult["engine"]): string {
  if (engine === "static") return "STATIC";
  if (engine === "dynamic-zero-fixture") return "DYNAMIC (no fixture)";
  return "DYNAMIC (fixture)";
}

function engineSummaryLine(label: string, results: TestResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIPPED").length;
  const errored = results.filter((r) => r.status === "ERRORED").length;

  const parts = [`${passed}/${total} passed`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (skipped > 0) parts.push(`${skipped} skipped (missing fixture data)`);
  if (errored > 0) parts.push(`${errored} errored (tool bug, not an app finding)`);
  return `${label}: ${parts.join(", ")}`;
}

export function renderConsoleReport(preflight: PreflightReport, results: TestResult[]): string {
  const lines: string[] = [];

  lines.push("PREFLIGHT:");
  if (preflight.fatalMessage) {
    lines.push(`  FATAL: ${preflight.fatalMessage}`);
    lines.push("");
    lines.push("Dynamic checks did not run because preflight failed fatally.");
    return lines.join("\n");
  }
  for (const r of preflight.results) {
    lines.push(`  ${r.passed ? "[ok]" : "[FAIL]"} ${r.name}: ${r.message}`);
  }
  lines.push(preflight.passed ? "  All checks passed." : "  Some preflight checks failed.");
  lines.push("");

  const byEngine = {
    static: results.filter((r) => r.engine === "static"),
    "dynamic-zero-fixture": results.filter((r) => r.engine === "dynamic-zero-fixture"),
    "dynamic-fixture": results.filter((r) => r.engine === "dynamic-fixture"),
  };
  for (const [engine, group] of Object.entries(byEngine)) {
    if (group.length === 0) continue;
    lines.push(engineSummaryLine(engineLabel(engine as TestResult["engine"]), group));
  }
  lines.push("");

  const byCategory = new Map<string, TestResult[]>();
  for (const r of results) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r);
  }
  for (const [category, group] of byCategory) {
    lines.push(`${category}:`);
    for (const r of group) {
      lines.push(`  [${r.status}] ${r.id} ${r.name} — ${r.message}`);
      if ((r.status === "FAIL" || r.status === "SKIPPED" || r.status === "ERRORED") && r.hint) {
        lines.push(`      hint: ${r.hint}`);
      }
    }
  }
  lines.push("");

  const collector = new ResultCollector();
  for (const r of results) collector.add(r);
  const summary = collector.summary();
  lines.push(
    `Overall: ${summary.PASS} passed, ${summary.FAIL} failed, ${summary.SKIPPED} skipped, ` +
      `${summary.NOT_COVERED} not covered, ${summary.ERRORED} errored`,
  );

  return lines.join("\n");
}
