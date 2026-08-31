import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "J2")!;

/**
 * `features.searchAttributes` already gates N_A in the orchestrator; this
 * check additionally needs the actual key names to set/query once that
 * flag is true.
 *
 * OPEN RESEARCH ITEM (flagged in the Phase 3 plan, not resolved here): it's
 * not yet confirmed whether the ephemeral local dev server
 * (`TestWorkflowEnvironment`) requires custom search attribute keys to be
 * pre-registered before a workflow can set them, the way production
 * Temporal Cloud does. Whatever the real implementation turns out to need
 * (a sample-project workflow calling `upsertSearchAttributes()`, and
 * possibly a pre-registration step) is deferred to when this check is
 * actually built. Not yet implemented — Phase 3 in progress.
 */
export const checkJ2SearchAttributes: DynamicFixtureCheckFn = async (_env, target, features) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(features.customSearchAttributeKeys)) {
    return missingFixtureResult(base, "features.customSearchAttributeKeys");
  }

  throw new Error("J2 not yet implemented (Phase 3 in progress)");
};
