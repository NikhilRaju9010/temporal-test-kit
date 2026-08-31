import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "D3")!;

/** Not yet implemented — Phase 3 in progress. See d2.ts for why this keys off features.scheduleWorkflowId. */
export const checkD3OverlappingSchedules: DynamicFixtureCheckFn = async (_env, target, features) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(features.scheduleWorkflowId)) {
    return missingFixtureResult(base, "features.scheduleWorkflowId");
  }

  throw new Error("D3 not yet implemented (Phase 3 in progress)");
};
