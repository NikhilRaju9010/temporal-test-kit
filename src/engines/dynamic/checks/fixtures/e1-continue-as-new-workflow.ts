import { continueAsNew } from "@temporalio/workflow";

/**
 * Throwaway probe fixture for E1 only. E1 needs to prove Continue-As-New
 * actually works as a mechanism — that a workflow can reset its own event
 * history mid-execution and still ultimately complete correctly under the
 * same Workflow ID — which is a platform/SDK property, not something the
 * target project's own `workflowType` can be relied on to exercise (E1 has
 * no way to know whether the project under test is even designed to run
 * long enough to need Continue-As-New; that's Phase 3 fixture data
 * (`workflows[].isLongRunning`) this zero-fixture check doesn't have).
 * So, same reasoning as D1, E1 brings its own minimal workflow that
 * continues-as-new a couple of times before finishing. Namespaced `e1-`
 * per CLAUDE.md's fixture convention so it can't collide with any other
 * check's fixtures.
 */
export async function E1ContinueAsNewWorkflow(iteration = 0): Promise<string> {
  if (iteration >= 2) {
    return "done";
  }
  await continueAsNew<typeof E1ContinueAsNewWorkflow>(iteration + 1);
  // continueAsNew() never returns (Promise<never>) — control never reaches
  // here — but TS still needs a return path for the async function's type.
  throw new Error("unreachable: continueAsNew should have thrown/replaced the workflow task");
}
