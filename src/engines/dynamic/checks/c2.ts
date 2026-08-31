import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "C2")!;

/** Not yet implemented — Phase 3 in progress. Only the SKIPPED-when-missing-fixture path is built so far. */
export const checkC2Queries: DynamicFixtureCheckFn = async (_env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.queries)) {
    return missingFixtureResult(base, "workflows[].queries");
  }

  throw new Error("C2 not yet implemented (Phase 3 in progress)");
};
