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

// --- SagaWorkflow: fixture for G1 (saga/compensation) and K2 (sensitive data) ---
//
// A real 3-step saga (reserve → charge → ship) with real compensation: if
// the charge step fails, it releases the inventory it already reserved
// before re-throwing, rather than leaving things half-done. This exists so
// temporal-test-kit's G1 check has genuine compensation behavior to
// exercise, not just a workflow that happens to throw.
//
// G1 forces the charge step to fail via fault injection (substituting
// chargeCardActivity's implementation at the WORKER level for the check's
// own run — see fault-injection.ts) and then verifies, from the recorded
// event history: reserveInventoryActivity (before the failure point) DID
// run, shipOrderActivity (after it) did NOT run, and the workflow reached a
// clean terminal FAILED state — not stuck, not falsely reported as
// COMPLETED. releaseInventoryActivity having run is reported as
// corroborating evidence of real compensation, not the check's pass/fail
// bar itself (see G1's own file for why).
//
// `cardNumber` doubles as K2's sensitive-data-detection target via config's
// `sensitiveDataFields: ["cardNumber"]`. The value below is Stripe's own
// published test Visa number (4242 4242 4242 4242) — a standard,
// universally-recognized placeholder used across the payments industry for
// exactly this purpose, never a real card, and never charged to anything
// here. It is INTENTIONALLY left in plain text (no redacting data
// converter configured for this sample project) so K2 has a real, honest
// FAIL to report by default — this is a deliberate fixture choice for K2 to
// detect, not an oversight.
const { reserveInventoryActivity, chargeCardActivity, shipOrderActivity, releaseInventoryActivity } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "10 seconds",
    retry: {
      initialInterval: "1 second",
      maximumAttempts: 3,
    },
  });

export interface SagaOrderInput {
  orderId: string;
  cardNumber: string;
  amount: number;
}

export async function SagaWorkflow(input: SagaOrderInput): Promise<string> {
  await reserveInventoryActivity(input.orderId);
  try {
    await chargeCardActivity(input.cardNumber, input.amount);
  } catch (err) {
    await releaseInventoryActivity(input.orderId);
    throw err;
  }
  await shipOrderActivity(input.orderId);
  return `order ${input.orderId} completed`;
}
