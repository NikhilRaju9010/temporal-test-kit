import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "H1")!;

/**
 * `hasCleanupOnCancel` is a boolean where `false` is a real value, so this
 * checks `!== true` explicitly, same reasoning as E2/F1.
 * Not yet implemented — Phase 3 in progress.
 */
export const checkH1CancelRunsCleanup: DynamicFixtureCheckFn = async (_env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (target.hasCleanupOnCancel !== true) {
    return missingFixtureResult(base, "workflows[].hasCleanupOnCancel");
  }

  throw new Error("H1 not yet implemented (Phase 3 in progress)");
};
