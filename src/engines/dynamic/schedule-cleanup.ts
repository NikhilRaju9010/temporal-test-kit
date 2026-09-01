import { ScheduleHandle } from "@temporalio/client";
import { EphemeralEnvironment } from "./environment.js";

/**
 * Shared cleanup for D2/D3/D4 (see each check's own doc comment for why they
 * each create their own throwaway recurring Schedule rather than querying an
 * existing one). None of these checks run a worker against the throwaway
 * schedule's task queue — that's deliberate, not an oversight: D2 needs
 * multiple *concurrent* actions to observe firing cadence regardless of
 * whether any one of them ever "completes" business logic, D3 needs an
 * action that never completes in order to force a real overlap, and D4's
 * backfill doesn't need a worker at all to prove the schedule recognized
 * missed occurrences. The consequence is that every workflow execution one
 * of these throwaway schedules starts is left permanently "Running" (no
 * worker ever polls its task queue to close it) unless explicitly
 * terminated.
 *
 * Left alone, those open executions would sit on the SAME task queue a
 * later dynamic-fixture check's own REAL worker (booted via
 * `withRunningWorker`) polls for the rest of this audit run — that worker
 * would pick up the leftover workflow task and execute the target project's
 * REAL activities for it (e.g. actually "charging a card" again for a
 * leftover SagaWorkflow execution), silently polluting a later, unrelated
 * check. This function is called from every D2/D3/D4 exit path (PASS, FAIL,
 * and the catch-all setup-error branch) to prevent that: it terminates every
 * workflow execution the schedule is known to have started, then deletes
 * the schedule itself. Best-effort throughout — a cleanup failure must never
 * mask the check's real result, so every failure here is swallowed.
 */
export async function cleanupSchedule(env: EphemeralEnvironment, handle: ScheduleHandle): Promise<void> {
  try {
    const description = await handle.describe();
    // recentActions is ScheduleExecutionResult[] (`.action.workflow`);
    // runningActions is already ScheduleExecutionActionResult[] (`.workflow`
    // directly, no `.action` wrapper) — different shapes for the same
    // underlying "which workflow execution" info.
    const executions = [
      ...description.info.recentActions.map((a) => a.action.workflow),
      ...description.info.runningActions.map((a) => a.workflow),
    ];
    const seen = new Set<string>();
    for (const { workflowId, firstExecutionRunId } of executions) {
      const key = `${workflowId}:${firstExecutionRunId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await env.client.workflow
        .getHandle(workflowId, firstExecutionRunId)
        .terminate("temporal-test-kit: throwaway schedule cleanup")
        .catch(() => {});
    }
  } catch {
    // describe() can itself fail (e.g. the schedule was never successfully
    // created) — nothing to clean up in that case, and this must not throw.
  } finally {
    await handle.delete().catch(() => {});
  }
}
