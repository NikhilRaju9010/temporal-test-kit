#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "./config/load.js";
import { runPreflight } from "./engines/preflight/run-preflight.js";
import { EphemeralEnvironment, WorkerTarget, withEphemeralEnvironment } from "./engines/dynamic/environment.js";
import { checkA1WorkflowStarts } from "./engines/dynamic/checks/a1.js";
import { checkA3DuplicateStart } from "./engines/dynamic/checks/a3.js";
import { checkA4DataIntegrity } from "./engines/dynamic/checks/a4.js";
import { checkB4Heartbeats } from "./engines/dynamic/checks/b4.js";
import { checkB5CancellationStops } from "./engines/dynamic/checks/b5.js";
import { checkD1Timers } from "./engines/dynamic/checks/d1.js";
import { checkE1ContinueAsNew } from "./engines/dynamic/checks/e1.js";
import { checkH2TerminateSkipsCleanup } from "./engines/dynamic/checks/h2.js";
import { checkI1WorkerCrashRecovery } from "./engines/dynamic/checks/i1.js";
import { checkI3Replay } from "./engines/dynamic/checks/i3.js";
import { checkI4TaskQueue } from "./engines/dynamic/checks/i4.js";
import { checkI5StickyRecovery } from "./engines/dynamic/checks/i5.js";
import { checkJ1EventHistory } from "./engines/dynamic/checks/j1.js";
import { checkJ3FailureMessages } from "./engines/dynamic/checks/j3.js";
import { checkK1DataConverterRoundTrip } from "./engines/dynamic/checks/k1.js";
import { checkL1ConnectionLossRecovery } from "./engines/dynamic/checks/l1.js";
import { runCheckWithGuards } from "./engines/dynamic/run-check.js";
import { checkA2NoUnsafeCode, checkB1Timeouts, checkB2RetryPolicy } from "./engines/static/checks.js";
import { renderConsoleReport } from "./report/console-reporter.js";
import { renderHtmlReport } from "./report/html-reporter.js";
import { TestResult } from "./report/types.js";
import { TestKitConfig } from "./config/schema.js";
import { CATALOG } from "./catalog.js";

const CONFIG_FILENAME = "temporal-test-kit.config.json";

function usage(): void {
  console.log(
    [
      "Usage: temporal-test-kit <command>",
      "",
      "Commands:",
      "  run     Run the static engine only.",
      "  audit   Run preflight + static + zero-fixture dynamic checks (Phase 2a scope).",
      "",
      "Not yet implemented (later phases): init, --list, --interactive",
    ].join("\n"),
  );
}

function staticResults(projectRoot: string, workflowsPath: string): TestResult[] {
  let source: string;
  try {
    source = readFileSync(workflowsPath, "utf-8");
  } catch {
    return [];
  }

  const checks = [
    { entry: CATALOG.find((c) => c.id === "A2")!, result: checkA2NoUnsafeCode(source) },
    { entry: CATALOG.find((c) => c.id === "B1")!, result: checkB1Timeouts(source) },
    { entry: CATALOG.find((c) => c.id === "B2")!, result: checkB2RetryPolicy(source) },
  ];

  return checks.map(({ entry, result }) => ({
    id: entry.id,
    category: entry.category,
    name: entry.name,
    status: result.status,
    target: workflowsPath,
    message: result.message,
    hint: result.status === "FAIL" ? result.hint : null,
    engine: "static" as const,
  }));
}

type ZeroFixtureCheckFn = (
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
) => Promise<TestResult>;

/**
 * The zero-fixture dynamic checks (spec Section 6.2 lists 16 total). Each
 * entry's `id` must have a matching CATALOG row; order here is just
 * registration order, not report order (the report groups by category).
 * `timeoutMs` overrides `runCheckWithGuards`'s default 15s budget — most
 * checks fit well within it, but a check that must wait out a REAL timeout
 * (a killed worker's activity task expiring, a dropped connection
 * reconnecting) genuinely needs more wall-clock time; that's not a bug to
 * optimize away, it's what the check is actually testing.
 */
const ZERO_FIXTURE_CHECKS: { id: string; fn: ZeroFixtureCheckFn; timeoutMs?: number }[] = [
  { id: "A1", fn: checkA1WorkflowStarts },
  { id: "A3", fn: checkA3DuplicateStart },
  { id: "A4", fn: checkA4DataIntegrity },
  { id: "B4", fn: checkB4Heartbeats },
  { id: "B5", fn: checkB5CancellationStops },
  { id: "D1", fn: checkD1Timers },
  { id: "E1", fn: checkE1ContinueAsNew },
  { id: "H2", fn: checkH2TerminateSkipsCleanup },
  { id: "I1", fn: checkI1WorkerCrashRecovery, timeoutMs: 40_000 },
  { id: "I3", fn: checkI3Replay },
  { id: "I4", fn: checkI4TaskQueue },
  { id: "I5", fn: checkI5StickyRecovery },
  { id: "J1", fn: checkJ1EventHistory },
  { id: "J3", fn: checkJ3FailureMessages },
  { id: "K1", fn: checkK1DataConverterRoundTrip },
  { id: "L1", fn: checkL1ConnectionLossRecovery },
];

async function zeroFixtureDynamicResults(
  env: EphemeralEnvironment,
  projectRoot: string,
  config: TestKitConfig,
): Promise<TestResult[]> {
  const workflowsPath = join(projectRoot, dirname(config.workerEntryPoint), "workflows.ts");
  const activities = await import(join(projectRoot, dirname(config.workerEntryPoint), "activities.ts"));

  const results: TestResult[] = [];
  for (const workflow of config.workflows) {
    for (const { id, fn, timeoutMs } of ZERO_FIXTURE_CHECKS) {
      const entry = CATALOG.find((c) => c.id === id)!;
      results.push(
        await runCheckWithGuards(
          () =>
            fn(env, {
              workflowType: workflow.type,
              taskQueue: workflow.taskQueue,
              workflowsPath,
              activities,
            }),
          {
            id: entry.id,
            category: entry.category,
            name: entry.name,
            target: workflow.type,
            engine: "dynamic-zero-fixture",
          },
          timeoutMs,
        ),
      );
    }
  }
  return results;
}

function notCoveredResults(): TestResult[] {
  return CATALOG.filter((c) => c.engine === "not-covered").map((c) => ({
    id: c.id,
    category: c.category,
    name: c.name,
    status: "NOT_COVERED" as const,
    target: null,
    message: "Requires real staging/multi-node/chaos infrastructure this local tool can't provide.",
    hint: null,
    engine: "dynamic-zero-fixture" as const,
  }));
}

async function runAudit(projectRoot: string): Promise<void> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  const configResult = loadConfig(configPath);

  await withEphemeralEnvironment(async (env) => {
    const preflight = await runPreflight({
      projectRoot,
      configResult,
      nodeVersion: process.version,
      port: 58732,
      env,
    });

    let results: TestResult[] = [];
    if (preflight.passed && configResult.ok) {
      const workflowsPath = join(projectRoot, dirname(configResult.config.workerEntryPoint), "workflows.ts");
      results = [
        ...staticResults(projectRoot, workflowsPath),
        ...(await zeroFixtureDynamicResults(env, projectRoot, configResult.config)),
        ...notCoveredResults(),
      ];
    }

    console.log(renderConsoleReport(preflight, results));

    const html = renderHtmlReport(preflight, results);
    const outDir = join(projectRoot, "temporal-test-kit-report");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "index.html"), html);
    console.log(`\nHTML report written to ${join(outDir, "index.html")}`);

    const hasProblem = results.some((r) => r.status === "FAIL" || r.status === "ERRORED");
    process.exitCode = hasProblem || !preflight.passed ? 1 : 0;
  });
}

async function runStaticOnly(projectRoot: string): Promise<void> {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  const configResult = loadConfig(configPath);
  if (!configResult.ok) {
    console.error(configResult.reason);
    process.exitCode = 1;
    return;
  }
  const workflowsPath = join(projectRoot, dirname(configResult.config.workerEntryPoint), "workflows.ts");
  const results = staticResults(projectRoot, workflowsPath);
  for (const r of results) {
    console.log(`[${r.status}] ${r.id} ${r.name} — ${r.message}`);
  }
  process.exitCode = results.some((r) => r.status === "FAIL") ? 1 : 0;
}

async function main(): Promise<void> {
  const [, , command] = process.argv;
  const projectRoot = resolve(process.cwd());

  switch (command) {
    case "run":
      await runStaticOnly(projectRoot);
      break;
    case "audit":
      await runAudit(projectRoot);
      break;
    case "init":
    case undefined:
      usage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
