import { condition, CancellationScope } from "@temporalio/workflow";

/**
 * Deliberately shields itself from cancellation via
 * `CancellationScope.nonCancellable`, so a `handle.cancel()` request is
 * delivered to the workflow but never propagates into the awaited
 * `condition(() => false)` — the workflow just keeps running instead of
 * reaching CANCELLED. This is the SDK-level equivalent of application code
 * catching a `CancelledFailure`/`isCancellation(err)` and swallowing it
 * without re-throwing. Used only by b5.test.ts to exercise
 * checkB5CancellationStops's FAIL branch (cancellation requested but not
 * honored within the grace period) — verified empirically against a real
 * ephemeral environment before writing the check: with this fixture, the
 * workflow observably stays RUNNING for as long as it's polled. Namespaced
 * `b5-` per CLAUDE.md's convention so it can't collide with any other
 * check's fixtures.
 */
export async function GreetingWorkflow(): Promise<string> {
  return CancellationScope.nonCancellable(async () => {
    await condition(() => false);
    return "unreachable";
  });
}
