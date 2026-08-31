import { proxyActivities, defineSignal, setHandler, condition } from "@temporalio/workflow";
import type * as activities from "./activities.js";

export const updateNameSignal = defineSignal<[string]>("updateNameSignal");

const { formatGreetingActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: {
    initialInterval: "1 second",
    maximumAttempts: 3,
  },
});

export async function GreetingWorkflow(initialName: string): Promise<string> {
  let name = initialName;

  setHandler(updateNameSignal, (newName: string) => {
    name = newName;
  });

  await condition(() => true);
  return formatGreetingActivity(name);
}
