import { condition } from "@temporalio/workflow";

/**
 * Deliberately never completes: `condition(() => false)` with no timeout
 * waits forever. Used only by i4.test.ts to exercise checkI4's
 * waitBudgetsMs.I4.correctQueueWaitMs override — proveCorrectQueuePickup
 * only needs handle.describe()'s reported task queue, not completion, so a
 * workflow that never completes still lets the check reach a correct PASS,
 * proving the override (not the default) bounded how long it waited before
 * describing. Namespaced `i4-` per CLAUDE.md's convention so it can't
 * collide with any other check's fixtures.
 */
export async function GreetingWorkflow(): Promise<string> {
  await condition(() => false);
  return "unreachable";
}
