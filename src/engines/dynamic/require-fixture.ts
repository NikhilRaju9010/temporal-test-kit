import { TestResult } from "../../report/types.js";

export interface FixtureCheckMeta {
  id: string;
  category: string;
  name: string;
  target: string | null;
  engine: "dynamic-fixture";
}

/**
 * True for anything that counts as "not filled in" for a fixture field —
 * undefined/null, an empty string, or an empty array. `false` is a real,
 * meaningful fixture value (e.g. `hasCleanupOnCancel: false`), not a missing
 * one, so it's deliberately excluded here.
 */
export function isFixtureMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * The one place every dynamic-fixture check builds its SKIPPED result —
 * keeps the spec's "always names exactly which config field would unlock
 * it" rule (Section 6.3) consistent across all 18 checks instead of each
 * one hand-rolling its own wording. `fieldName` should be the exact dotted
 * config path (e.g. `workflows[].sagaFailurePoint`, `features.schedules`)
 * so a dev can go straight to the field without guessing.
 */
export function missingFixtureResult(meta: FixtureCheckMeta, fieldName: string): TestResult {
  return {
    ...meta,
    status: "SKIPPED",
    message: `Skipped — ${fieldName} is not set in config`,
    hint: `Set ${fieldName} in temporal-test-kit.config.json to unlock this check.`,
  };
}
