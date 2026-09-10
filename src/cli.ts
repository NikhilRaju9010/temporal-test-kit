#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "./config/load.js";
import { writeInitConfig } from "./config/write-init-config.js";
import { computeListLines } from "./list-command.js";
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
import { checkB3Idempotency } from "./engines/dynamic/checks/b3.js";
import { checkC1Signals } from "./engines/dynamic/checks/c1.js";
import { checkC2Queries } from "./engines/dynamic/checks/c2.js";
import { checkC3UpdateValidation } from "./engines/dynamic/checks/c3.js";
import { checkC4UpdateWithStart } from "./engines/dynamic/checks/c4.js";
import { checkC5NoStuckOnSignalUpdate } from "./engines/dynamic/checks/c5.js";
import { checkD2SchedulesFireOnTime } from "./engines/dynamic/checks/d2.js";
import { checkD3OverlappingSchedules } from "./engines/dynamic/checks/d3.js";
import { checkD4MissedSchedules } from "./engines/dynamic/checks/d4.js";
import { checkE2ContinueAsNewStatePreserved } from "./engines/dynamic/checks/e2.js";
import { checkF1FailingChildHandled } from "./engines/dynamic/checks/f1.js";
import { checkF2ChildNotOrphaned } from "./engines/dynamic/checks/f2.js";
import { checkG1SagaCompensation } from "./engines/dynamic/checks/g1.js";
import { checkH1CancelRunsCleanup } from "./engines/dynamic/checks/h1.js";
import { checkH3CancelParentHandlesChildren } from "./engines/dynamic/checks/h3.js";
import { checkJ2SearchAttributes } from "./engines/dynamic/checks/j2.js";
import { checkK2SensitiveDataNotExposed } from "./engines/dynamic/checks/k2.js";
import { checkL2DependencyOutageRecovery } from "./engines/dynamic/checks/l2.js";
import { DynamicFixtureCheckFn } from "./engines/dynamic/fixture-check.js";
import { runCheckWithGuards } from "./engines/dynamic/run-check.js";
import {
  checkA2NoUnsafeCode,
  checkB1Timeouts,
  checkB2RetryPolicy,
  checkB6LocalActivitiesAreShort,
  checkG2PermanentFailuresDontRetryForever,
} from "./engines/static/checks.js";
import { renderConsoleReport } from "./report/console-reporter.js";
import { renderHtmlReport } from "./report/html-reporter.js";
import { TestResult } from "./report/types.js";
import { TestKitConfig, FeaturesConfig, WaitBudgetsConfig } from "./config/schema.js";
import { CATALOG } from "./catalog.js";

const CONFIG_FILENAME = "temporal-test-kit.config.json";

function usage(): void {
  console.log(
    [
      "Usage: temporal-test-kit <command>",
      "",
      "Commands:",
      "  init    Generate a starter temporal-test-kit.config.json in the current project.",
      "  run     Run the static engine only.",
      "  audit   Run preflight + static + zero-fixture dynamic + fixture-based dynamic checks.",
      "  audit --list   Print all checks' would-run/needs-fixture/N-A/not-covered status, without running anything.",
      "",
      "Not yet implemented (later phases): --interactive",
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
    { entry: CATALOG.find((c) => c.id === "B6")!, result: checkB6LocalActivitiesAreShort(source) },
    { entry: CATALOG.find((c) => c.id === "G2")!, result: checkG2PermanentFailuresDontRetryForever(source) },
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
  signal?: AbortSignal,
  waitBudgets?: WaitBudgetsConfig,
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
          (signal) =>
            fn(
              env,
              {
                workflowType: workflow.type,
                taskQueue: workflow.taskQueue,
                workflowsPath,
                activities,
              },
              signal,
              config.waitBudgetsMs,
            ),
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

/**
 * The 18 dynamic-fixture checks (spec Section 6.3). Each entry's `id` must
 * have a matching CATALOG row, same convention as ZERO_FIXTURE_CHECKS.
 * Most of these are stubs as of Phase 3's first pass — SKIPPED-when-
 * missing-fixture is fully built for all 18, but only G1's real PASS/FAIL
 * logic exists so far (see each check's own file for its status).
 */
const DYNAMIC_FIXTURE_CHECKS: { id: string; fn: DynamicFixtureCheckFn; timeoutMs?: number }[] = [
  { id: "B3", fn: checkB3Idempotency },
  { id: "C1", fn: checkC1Signals },
  { id: "C2", fn: checkC2Queries },
  { id: "C3", fn: checkC3UpdateValidation },
  { id: "C4", fn: checkC4UpdateWithStart },
  { id: "C5", fn: checkC5NoStuckOnSignalUpdate },
  // D2/D3 each wait several real intervals of a throwaway Schedule they
  // create (env is createLocal(), not time-skipping — see d2.ts's doc
  // comment), so they legitimately need more than the default 15s budget.
  // D4 doesn't wait out real time (it uses ScheduleHandle.backfill()
  // instead — see d4.ts) but still gets a bit of headroom for its short
  // describe()-polling loop.
  { id: "D2", fn: checkD2SchedulesFireOnTime, timeoutMs: 30_000 },
  { id: "D3", fn: checkD3OverlappingSchedules, timeoutMs: 30_000 },
  { id: "D4", fn: checkD4MissedSchedules, timeoutMs: 20_000 },
  { id: "E2", fn: checkE2ContinueAsNewStatePreserved },
  // F1 runs a two-phase probe (a normal run to generically discover which
  // activity its child workflow calls, since no config field names it —
  // see f1.ts's doc comment — then a second, fault-injected run), so it
  // legitimately needs more than the default 15s budget.
  { id: "F1", fn: checkF1FailingChildHandled, timeoutMs: 30_000 },
  { id: "F2", fn: checkF2ChildNotOrphaned },
  { id: "G1", fn: checkG1SagaCompensation },
  { id: "H1", fn: checkH1CancelRunsCleanup },
  { id: "H3", fn: checkH3CancelParentHandlesChildren },
  { id: "J2", fn: checkJ2SearchAttributes },
  { id: "K2", fn: checkK2SensitiveDataNotExposed },
  { id: "L2", fn: checkL2DependencyOutageRecovery },
];

/**
 * Two-layer gating, per the spec's SKIPPED-vs-N_A distinction: a catalog
 * entry with `requiresFeatureFlag` is N_A — genuinely doesn't apply to this
 * project — whenever that flag is false/unset in config, decided HERE,
 * before the check function is even called (it never gets a chance to run,
 * unlike a missing per-workflow fixture field, which the check itself
 * reports as SKIPPED). Both statuses always carry a non-empty message;
 * only SKIPPED requires a hint (see ResultCollector).
 */
async function dynamicFixtureResults(
  env: EphemeralEnvironment,
  projectRoot: string,
  config: TestKitConfig,
): Promise<TestResult[]> {
  const workflowsPath = join(projectRoot, dirname(config.workerEntryPoint), "workflows.ts");
  const activities = await import(join(projectRoot, dirname(config.workerEntryPoint), "activities.ts"));
  const features: FeaturesConfig = config.features ?? {};

  const results: TestResult[] = [];
  for (const workflow of config.workflows) {
    for (const { id, fn, timeoutMs } of DYNAMIC_FIXTURE_CHECKS) {
      const entry = CATALOG.find((c) => c.id === id)!;

      if (entry.requiresFeatureFlag && !features[entry.requiresFeatureFlag as keyof FeaturesConfig]) {
        results.push({
          id: entry.id,
          category: entry.category,
          name: entry.name,
          status: "N_A",
          target: workflow.type,
          message: `Not applicable — this project doesn't use ${entry.requiresFeatureFlag} (features.${entry.requiresFeatureFlag} is false/unset in config)`,
          hint: null,
          engine: "dynamic-fixture",
        });
        continue;
      }

      results.push(
        await runCheckWithGuards(
          (signal) => fn(env, { ...workflow, workflowsPath, activities }, features, signal, config.waitBudgetsMs),
          {
            id: entry.id,
            category: entry.category,
            name: entry.name,
            target: workflow.type,
            engine: "dynamic-fixture",
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

function runList(projectRoot: string): void {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  const configResult = loadConfig(configPath);
  if (!configResult.ok) {
    console.error(configResult.reason);
    process.exitCode = 1;
    return;
  }

  console.log(`temporal-test-kit --list — all ${CATALOG.length} checks against the current config, without running anything:\n`);
  for (const line of computeListLines(configResult.config)) {
    console.log(line);
  }
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
        ...(await dynamicFixtureResults(env, projectRoot, configResult.config)),
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

function runInit(projectRoot: string): void {
  const result = writeInitConfig(projectRoot);
  if (!result.ok) {
    console.error(result.reason);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Wrote a starter ${CONFIG_FILENAME} to ${result.path}.\n` +
      'Fill in the fields your project needs (see the comments in the file), then run "temporal-test-kit audit".',
  );
}

async function main(): Promise<void> {
  const [, , command] = process.argv;
  const projectRoot = resolve(process.cwd());

  switch (command) {
    case "run":
      await runStaticOnly(projectRoot);
      break;
    case "audit":
      if (process.argv.includes("--list")) {
        runList(projectRoot);
      } else {
        await runAudit(projectRoot);
      }
      break;
    case "init":
      runInit(projectRoot);
      break;
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
