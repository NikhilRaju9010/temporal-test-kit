import { ApplicationFailure } from "@temporalio/common";

/**
 * Deliberately fails with a specific, useful error message: used only by
 * j3.test.ts to exercise checkJ3's PASS branch (message quality heuristic
 * trusts messages with actual content). Namespaced `j3-` per CLAUDE.md's
 * convention so it can't collide with any other check's fixtures.
 *
 * Throws a non-retryable ApplicationFailure rather than a plain Error — see
 * j3-generic-failure-workflow.ts's comment for why: a plain thrown Error
 * only fails the workflow *task* (retried indefinitely), never the
 * execution, so `handle.result()` would never reject.
 */
export async function GreetingWorkflow(): Promise<string> {
  throw ApplicationFailure.nonRetryable(
    "Cannot format greeting: initialName is required but was undefined. Pass a non-empty string as the first workflow argument.",
  );
}
