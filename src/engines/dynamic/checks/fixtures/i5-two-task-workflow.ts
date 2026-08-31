import { condition, defineSignal, setHandler } from "@temporalio/workflow";

/**
 * Throwaway fixture for I5 only. I5 needs a workflow that requires AT LEAST
 * TWO separate workflow tasks — its first task completes near-instantly
 * (registering the signal handler and entering `condition()`), and a SECOND
 * workflow task is only produced once the `i5ContinueSignal` signal arrives.
 * This is what lets I5 exercise "does the workflow's *next* task get picked
 * up by a worker other than the one it was stickily assigned to" — a
 * workflow that finishes in a single task (like the sample project's
 * `GreetingWorkflow` with no signals) never produces a "next task" to get
 * stuck on sticky affinity in the first place.
 *
 * Namespaced `i5-` per CLAUDE.md's fixture convention so it can't collide
 * with any other check's fixtures.
 */
export const i5ContinueSignal = defineSignal("i5ContinueSignal");

export async function I5TwoTaskWorkflow(): Promise<string> {
  let signaled = false;
  setHandler(i5ContinueSignal, () => {
    signaled = true;
  });
  await condition(() => signaled); // forces a 2nd workflow task once signaled
  return "done";
}
