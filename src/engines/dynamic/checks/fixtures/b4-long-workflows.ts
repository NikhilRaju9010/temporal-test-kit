import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./b4-activities.js";

const { b4SleepWithHeartbeatActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 seconds",
});
const { b4SleepWithoutHeartbeatActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 seconds",
});

/**
 * Throwaway B4 fixture workflows pairing with fixtures/b4-activities.ts —
 * see that file's comment for why they exist. Namespaced `b4-` per
 * CLAUDE.md's fixture convention.
 */
export async function B4WorkflowWithHeartbeat(): Promise<string> {
  return b4SleepWithHeartbeatActivity();
}

export async function B4WorkflowWithoutHeartbeat(): Promise<string> {
  return b4SleepWithoutHeartbeatActivity();
}
