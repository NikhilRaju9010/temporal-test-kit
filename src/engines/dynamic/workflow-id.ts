import { randomBytes } from "node:crypto";

/**
 * The shared convention for every workflow ID a check starts (see CLAUDE.md
 * "Workflow ID convention"): `ttk-<testId>-<workflowType>-<timestamp>-<random>`.
 * Collision-safe across checks sharing one ephemeral environment/task queue
 * even if two checks fire in the same millisecond, since Phase 2b runs all
 * 16 zero-fixture checks against a single `env` rather than one per check.
 */
export function generateWorkflowId(testId: string, workflowType: string): string {
  const randomSuffix = randomBytes(4).toString("hex");
  return `ttk-${testId}-${workflowType}-${Date.now()}-${randomSuffix}`;
}
