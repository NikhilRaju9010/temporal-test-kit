import { condition } from "@temporalio/workflow";

/**
 * Deliberately never completes: `condition(() => false)` with no timeout
 * waits forever. Used only by a1.test.ts to exercise checkA1's still-RUNNING
 * branch — a workflow that's legitimately (or not) still waiting when the
 * check's bounded wait expires. Namespaced `a1-` per CLAUDE.md's convention
 * so it can't collide with any other check's fixtures.
 */
export async function GreetingWorkflow(): Promise<string> {
  await condition(() => false);
  return "unreachable";
}
