/**
 * ERRORED is a deliberate addition beyond the build spec's original five
 * statuses (PASS/FAIL/SKIPPED/N_A/NOT_COVERED): it marks a check that threw
 * an unhandled exception or timed out — a bug/limit in temporal-test-kit
 * itself, or an inconclusive run — never a finding about the project under
 * test. Conflating this with FAIL would report "the tool broke" as if it
 * were "the app broke," which violates the spec's own honesty principle
 * (never fake or misattribute a result). Only the shared orchestrator
 * (src/engines/dynamic/run-check.ts) produces this status; individual
 * checks never construct it themselves.
 */
export type Status = "PASS" | "FAIL" | "SKIPPED" | "N_A" | "NOT_COVERED" | "ERRORED";

export type Engine = "static" | "dynamic-zero-fixture" | "dynamic-fixture";

export interface TestResult {
  id: string;
  category: string;
  name: string;
  status: Status;
  target: string | null;
  message: string;
  hint: string | null;
  engine: Engine;
}

export interface PreflightResult {
  name: string;
  passed: boolean;
  message: string;
}

export interface PreflightReport {
  passed: boolean;
  results: PreflightResult[];
  /** Set when a fatal preflight failure (e.g. worker boot) should stop all dynamic checks. */
  fatalMessage: string | null;
}
