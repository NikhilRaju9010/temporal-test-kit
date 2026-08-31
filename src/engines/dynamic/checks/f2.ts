import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "F2")!;

/** Not yet implemented — Phase 3 in progress. See f1.ts for why this checks hasChildWorkflows !== true. */
export const checkF2ChildNotOrphaned: DynamicFixtureCheckFn = async (_env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (target.hasChildWorkflows !== true) {
    return missingFixtureResult(base, "workflows[].hasChildWorkflows");
  }

  throw new Error("F2 not yet implemented (Phase 3 in progress)");
};
