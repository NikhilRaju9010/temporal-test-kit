import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./i1-activities.js";

const { i1RecordExecutionActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "4 seconds",
});

/**
 * Throwaway fixture for I1 only, pairing with fixtures/i1-activities.ts. I1
 * needs a workflow whose single activity call can be caught mid-execution
 * and forced to retry on a different (real OS process) worker — see that
 * file's comment for the exact mechanism. A short `startToCloseTimeout`
 * (above) is what makes the abandoned first attempt get noticed and
 * rescheduled promptly in real wall-clock time once its worker is killed,
 * rather than the test waiting out a long default timeout. Namespaced `i1-`
 * per CLAUDE.md's fixture convention so it can't collide with any other
 * check's fixtures.
 */
export async function I1SideEffectWorkflow(recordPath: string, startedMarkerPath: string, delayMs: number): Promise<string> {
  return i1RecordExecutionActivity(recordPath, startedMarkerPath, delayMs);
}
