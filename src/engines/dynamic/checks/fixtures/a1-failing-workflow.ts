/**
 * Deliberately throws immediately: used only by a1.test.ts to exercise
 * checkA1's FAILED branch. Namespaced `a1-` per CLAUDE.md's convention so it
 * can't collide with any other check's fixtures.
 */
export async function GreetingWorkflow(): Promise<string> {
  throw new Error("this workflow always fails");
}
