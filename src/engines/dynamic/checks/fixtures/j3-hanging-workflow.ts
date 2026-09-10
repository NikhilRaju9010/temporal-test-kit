import { condition } from "@temporalio/workflow";

/**
 * Deliberately never completes: `condition(() => false)` with no timeout
 * waits forever. Used only by j3.test.ts to exercise checkJ3's
 * waitBudgetsMs.J3.waitTimeoutMs override — a workflow still RUNNING (not
 * COMPLETED) when the check's bounded wait expires hits the branch that
 * names the exact wait value used in its SKIPPED message. Namespaced `j3-`
 * per CLAUDE.md's convention so it can't collide with any other check's
 * fixtures.
 */
export async function GreetingWorkflow(): Promise<string> {
  await condition(() => false);
  return "unreachable";
}
