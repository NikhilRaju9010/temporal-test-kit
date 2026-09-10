import { condition } from "@temporalio/workflow";

/**
 * Deliberately never completes: `condition(() => false)` with no timeout
 * waits forever. Used only by a4.test.ts to exercise checkA4's
 * waitBudgetsMs.A4.waitTimeoutMs override — a4's grading only depends on
 * the WorkflowExecutionStarted event (written synchronously at start), so a
 * workflow that never completes still lets the check reach a correct PASS,
 * proving the override (not the default) bounded how long the check waited.
 * Namespaced `a4-` per CLAUDE.md's convention so it can't collide with any
 * other check's fixtures.
 */
export async function GreetingWorkflow(): Promise<string> {
  await condition(() => false);
  return "unreachable";
}
