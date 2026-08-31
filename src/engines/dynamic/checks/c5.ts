import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "C5")!;

/**
 * C5 ("Signal/update handling doesn't get the workflow stuck") needs at
 * least one signal OR update configured to have anything to exercise —
 * unlike C1-C4, it isn't gated on a single field.
 * Not yet implemented — Phase 3 in progress. Only the SKIPPED-when-missing-
 * fixture path is built so far.
 */
export const checkC5NoStuckOnSignalUpdate: DynamicFixtureCheckFn = async (_env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.signals) && isFixtureMissing(target.updates)) {
    return missingFixtureResult(base, "workflows[].signals or workflows[].updates");
  }

  throw new Error("C5 not yet implemented (Phase 3 in progress)");
};
