import { condition } from "@temporalio/workflow";

/**
 * Deliberately never completes: `condition(() => false)` with no timeout
 * waits forever. Used only by i3.test.ts to exercise checkI3's
 * waitBudgetsMs.I3.runTimeoutMs override — the check's own replay logic
 * only needs a valid history up to whatever point recording stopped, so a
 * workflow that never completes still lets the check reach a correct PASS,
 * proving the override (not the default) bounded how long recording waited.
 * Namespaced `i3-` per CLAUDE.md's convention so it can't collide with any
 * other check's fixtures.
 */
export async function GreetingWorkflow(): Promise<string> {
  await condition(() => false);
  return "unreachable";
}
