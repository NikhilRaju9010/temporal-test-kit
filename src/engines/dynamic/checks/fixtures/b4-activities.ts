import { Context } from "@temporalio/activity";

/**
 * Throwaway B4 fixture: deliberately sleeps past B4's
 * LONG_ACTIVITY_THRESHOLD_MS (2s) while heartbeating periodically, to
 * exercise checkB4Heartbeats' "long activity, heartbeat present → PASS"
 * branch. Namespaced `b4-` per CLAUDE.md's fixture convention so it can't
 * collide with any other check's fixtures.
 */
export async function b4SleepWithHeartbeatActivity(): Promise<string> {
  const ctx = Context.current();
  const totalMs = 3_000;
  const stepMs = 400;
  let elapsed = 0;
  while (elapsed < totalMs) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    elapsed += stepMs;
    ctx.heartbeat({ elapsedMs: elapsed });
  }
  return "done-with-heartbeat";
}

/**
 * Same duration as b4SleepWithHeartbeatActivity, but never calls
 * heartbeat() — exercises checkB4Heartbeats' "long activity, no heartbeat →
 * FAIL" branch.
 */
export async function b4SleepWithoutHeartbeatActivity(): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  return "done-without-heartbeat";
}
