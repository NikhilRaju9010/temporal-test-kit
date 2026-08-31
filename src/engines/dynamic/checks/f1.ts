import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "F1")!;

/**
 * `hasChildWorkflows` is a boolean where `false` is a real value, so this
 * checks `!== true` explicitly, same reasoning as E2's isLongRunning.
 * N_A gating on `features.childWorkflows` happens in the orchestrator.
 * Not yet implemented — Phase 3 in progress.
 */
export const checkF1FailingChildHandled: DynamicFixtureCheckFn = async (_env, target) => {
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

  throw new Error("F1 not yet implemented (Phase 3 in progress)");
};
