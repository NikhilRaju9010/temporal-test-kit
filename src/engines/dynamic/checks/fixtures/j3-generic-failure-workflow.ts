import { ApplicationFailure } from "@temporalio/common";

/**
 * Deliberately fails with a generic, useless error message: used only by
 * j3.test.ts to exercise checkJ3's FAIL branch (message quality heuristic
 * flags short/known-generic strings). Namespaced `j3-` per CLAUDE.md's
 * convention so it can't collide with any other check's fixtures.
 *
 * Throws a non-retryable ApplicationFailure rather than a plain Error:
 * throwing a plain Error from workflow code only fails the *workflow task*
 * (Temporal retries it indefinitely), it doesn't fail the workflow
 * *execution* — there'd be nothing for `handle.result()` to ever reject
 * with. An explicit non-retryable ApplicationFailure fails the execution
 * immediately, which is what this check needs to grade.
 */
export async function GreetingWorkflow(): Promise<string> {
  throw ApplicationFailure.nonRetryable("Error");
}
