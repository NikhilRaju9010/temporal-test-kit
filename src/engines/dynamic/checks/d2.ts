import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "D2")!;

/**
 * D2-D4 all key off `features.scheduleWorkflowId`, not a per-workflow
 * field — `requiresFeatureFlag: "schedules"` already gates N_A in the
 * orchestrator; this check additionally needs the schedule's own workflow
 * ID once that flag is true. Not yet implemented — Phase 3 in progress.
 */
export const checkD2SchedulesFireOnTime: DynamicFixtureCheckFn = async (_env, target, features) => {
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

  throw new Error("D2 not yet implemented (Phase 3 in progress)");
};
