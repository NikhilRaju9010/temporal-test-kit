import { condition, defineSignal, setHandler } from "@temporalio/workflow";

/**
 * Throwaway fixture for L1 only, same shape as I5's `i5-two-task-workflow.ts`
 * (see that file's comment for why a check like this needs a workflow that
 * spans TWO separate workflow tasks rather than completing in one). L1 needs
 * this so its first task can run against one `NativeConnection`, that
 * connection can then be closed, and its SECOND task only gets processed
 * once a fresh connection (and worker) picks it back up — proving the
 * workflow's state survives the connection going away, independent of
 * whatever it takes to notice and reconnect.
 *
 * Namespaced `l1-` per CLAUDE.md's fixture convention so it can't collide
 * with any other check's fixtures.
 */
export const l1ContinueSignal = defineSignal("l1ContinueSignal");

export async function L1TwoTaskWorkflow(): Promise<string> {
  let signaled = false;
  setHandler(l1ContinueSignal, () => {
    signaled = true;
  });
  await condition(() => signaled); // forces a 2nd workflow task once signaled
  return "done";
}
