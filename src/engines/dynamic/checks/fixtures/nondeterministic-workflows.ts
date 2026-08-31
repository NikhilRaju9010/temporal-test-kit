import { defineSignal, setHandler, condition } from "@temporalio/workflow";

/**
 * Deliberately NOT equivalent to examples/sample-project/src/workflows.ts —
 * same exported name/signal so it can be registered as a stand-in for
 * GreetingWorkflow, but it never calls an activity. Used only by
 * i3.test.ts to prove checkI3Replay actually flags a nondeterminism error
 * when history recorded under one version of the code is replayed against
 * a structurally different version.
 */
export const updateNameSignal = defineSignal<[string]>("updateNameSignal");

export async function GreetingWorkflow(initialName: string): Promise<string> {
  setHandler(updateNameSignal, () => {
    // no-op: this version doesn't track the name at all
  });
  await condition(() => true);
  return `no activity call here: ${initialName}`;
}
