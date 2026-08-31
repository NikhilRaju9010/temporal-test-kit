import { condition } from "@temporalio/workflow";

/**
 * H2 needs something to terminate *while it's still running* — but the real
 * target workflow (e.g. examples/sample-project's GreetingWorkflow, which
 * takes no input and immediately falls through `condition(() => true)`)
 * would very likely already be COMPLETED by the time `handle.terminate()`
 * fires, which would test "terminating an already-closed workflow" instead
 * of the thing H2 actually cares about: does `terminate()` promptly move a
 * *live* execution to TERMINATED, skipping its cleanup path, as designed.
 *
 * H2's check (see ../h2.ts) is otherwise pure SDK/server behavior with zero
 * business-logic dependency on the project under test, so rather than rely
 * on the target project happening to expose a long-running workflow, it
 * starts this tiny throwaway probe instead: waits forever
 * (`condition(() => false)` with no timeout never resolves), guaranteeing
 * it's still RUNNING whenever terminate() is called. Namespaced `h2-` per
 * CLAUDE.md's file-per-fixture convention so it can't collide with any other
 * check's fixtures.
 */
export async function H2ProbeWorkflow(): Promise<never> {
  await condition(() => false);
  throw new Error("unreachable");
}
