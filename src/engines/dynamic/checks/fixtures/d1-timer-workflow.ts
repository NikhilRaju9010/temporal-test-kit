import { sleep } from "@temporalio/workflow";

/**
 * Throwaway timer fixture for D1 only. D1 needs to prove a workflow's TIMER
 * survives a worker going away and a new worker coming back — that's a
 * server-side durability property of Temporal itself, not something the
 * target project's own `workflowType` can be relied on to exercise (D1 has
 * no way to know whether the project under test uses `sleep`/timers at all,
 * since that's Phase 3 fixture data this zero-fixture check doesn't have).
 * So D1 brings its own minimal workflow that just sleeps and returns.
 * Namespaced `d1-` per CLAUDE.md's fixture convention so it can't collide
 * with any other check's fixtures.
 */
export async function D1TimerWorkflow(): Promise<string> {
  await sleep("3 seconds");
  return "timer fired";
}
