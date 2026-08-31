import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "C3")!;

/**
 * Not yet implemented — Phase 3 in progress. Only the SKIPPED-when-missing-
 * fixture path is built so far. N_A gating on `features.updates` happens in
 * the orchestrator (cli.ts), before this function is even called — this
 * check only ever needs to decide SKIPPED vs. a real result.
 */
export const checkC3UpdateValidation: DynamicFixtureCheckFn = async (_env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.updates)) {
    return missingFixtureResult(base, "workflows[].updates");
  }

  throw new Error("C3 not yet implemented (Phase 3 in progress)");
};
