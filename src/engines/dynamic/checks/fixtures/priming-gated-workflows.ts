import { condition, defineSignal, proxyActivities, setHandler, startChild } from "@temporalio/workflow";
import type * as activities from "./priming-activities.js";

/**
 * Fixtures for `workflows[].primingSignals`.
 *
 * Each of these gates real work behind `condition(() => unlocked)` with NO
 * timeout — the shape this feature exists for: a workflow that cannot leave
 * the wait on its own, so an activity beyond it is unreachable unless
 * something signals it. That makes each check's two priming tests a clean
 * pair with no timing assumptions: WITH priming the gated activity is
 * reached, WITHOUT it the check reports its normal "never invoked" result,
 * which is also the proof that omitting the field sends nothing.
 *
 * Namespaced `priming-` per CLAUDE.md's fixture convention.
 */
export const unlockSignal = defineSignal("unlockSignal");

const { gatedActivity, childGatedActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 3 },
});

/** Blocks forever until `unlockSignal`, then runs `gatedActivity`. */
export async function GatedWorkflow(): Promise<string> {
  let unlocked = false;
  setHandler(unlockSignal, () => {
    unlocked = true;
  });
  await condition(() => unlocked);
  return gatedActivity();
}

/** The child F1/F2/H3 discover. Runs an activity so F1 has one to fault-inject. */
export async function GatedChildWorkflow(): Promise<string> {
  return childGatedActivity();
}

/**
 * Blocks forever until `unlockSignal`, and only THEN starts its child — so
 * without priming there is no child to discover at all, which is exactly what
 * F2/H3's "never actually started a child workflow" branch reports.
 */
export async function GatedParentWorkflow(): Promise<string> {
  let unlocked = false;
  setHandler(unlockSignal, () => {
    unlocked = true;
  });
  await condition(() => unlocked);
  const child = await startChild(GatedChildWorkflow, { args: [] });
  return child.result();
}
