import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "E2")!;

/**
 * `isLongRunning` is a boolean where `false` is a real, meaningful value
 * (this workflow genuinely isn't long-running) — not just "missing" —  so
 * this checks for `!== true` explicitly rather than using
 * `isFixtureMissing` (which treats `false` as present).
 * Not yet implemented — Phase 3 in progress.
 */
export const checkE2ContinueAsNewStatePreserved: DynamicFixtureCheckFn = async (_env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (target.isLongRunning !== true) {
    return missingFixtureResult(base, "workflows[].isLongRunning");
  }

  throw new Error("E2 not yet implemented (Phase 3 in progress)");
};
