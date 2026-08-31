export type Status = "PASS" | "FAIL" | "SKIPPED" | "N_A" | "NOT_COVERED";

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
