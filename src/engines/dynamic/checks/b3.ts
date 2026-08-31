import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "B3")!;

/**
 * B3 ("Retrying a step doesn't repeat its effect") is deliberately not
 * implemented yet — it needs its own design pass (per the Phase 3 plan)
 * before writing real logic: server-side "exactly one ActivityTaskCompleted
 * recorded" and real-world "the activity's actual side effect wasn't
 * duplicated" are related but NOT the same claim, and the check's
 * message/hint need to state honestly which one it's actually reporting
 * against — the same treatment L1 got for its narrower connection-loss
 * scope. Only the SKIPPED-when-missing-fixture path is built for now.
 */
export const checkB3Idempotency: DynamicFixtureCheckFn = async (_env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.idempotencyTestActivity)) {
    return missingFixtureResult(base, "workflows[].idempotencyTestActivity");
  }

  throw new Error("B3 not yet implemented — needs its own design pass before real logic is written (see Phase 3 plan)");
};
