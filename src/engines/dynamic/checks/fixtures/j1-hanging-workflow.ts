import { condition } from "@temporalio/workflow";

/**
 * Deliberately never completes: `condition(() => false)` with no timeout
 * waits forever. Used only by j1.test.ts to exercise checkJ1's
 * waitBudgetsMs.J1.waitTimeoutMs override — a workflow that's still RUNNING
 * when the check's bounded wait expires produces a message naming the
 * exact wait value used. Namespaced `j1-` per CLAUDE.md's convention so it
 * can't collide with any other check's fixtures.
 */
export async function GreetingWorkflow(): Promise<string> {
  await condition(() => false);
  return "unreachable";
}
