import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "L2")!;

/**
 * L2 ("A dependency outage doesn't lose work") will reuse
 * `withFaultInjectedWorker` (see fault-injection.ts, built for G1) to
 * simulate `dependencyOutageTestActivity` failing temporarily and confirm
 * the workflow recovers once it succeeds again. Not yet implemented —
 * Phase 3 in progress. Only the SKIPPED-when-missing-fixture path is built
 * so far.
 */
export const checkL2DependencyOutageRecovery: DynamicFixtureCheckFn = async (_env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.dependencyOutageTestActivity)) {
    return missingFixtureResult(base, "workflows[].dependencyOutageTestActivity");
  }

  throw new Error("L2 not yet implemented (Phase 3 in progress)");
};
