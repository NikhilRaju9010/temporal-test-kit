import { condition } from "@temporalio/workflow";

/**
 * Deliberately never completes on its own: `condition(() => false)` with no
 * timeout waits forever. Used by b5.test.ts so checkB5CancellationStops has
 * a workflow guaranteed to still be RUNNING when `handle.cancel()` is
 * called — racing cancellation against a fast-completing workflow (like
 * examples/sample-project's GreetingWorkflow, which can finish before the
 * cancel request is even delivered) would make the "does cancellation take
 * effect promptly" assertion flaky. This fixture does not override
 * cancellation handling in any way, so it exercises Temporal's *default*
 * cancellation behavior: the SDK forces a workflow through cancellation
 * (throwing into whatever it's awaiting) unless the workflow code
 * deliberately shields itself from it. Namespaced `b5-` per CLAUDE.md's
 * convention so it can't collide with any other check's fixtures.
 */
export async function GreetingWorkflow(): Promise<string> {
  await condition(() => false);
  return "unreachable";
}
