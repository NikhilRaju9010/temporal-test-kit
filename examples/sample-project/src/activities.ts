export async function formatGreetingActivity(name: string): Promise<string> {
  return `Hello, ${name}!`;
}

// --- SagaWorkflow's steps (fixture for G1 saga/compensation, reused by K2 sensitive-data) ---
// See workflows.ts's SagaWorkflow doc comment for why these exist and how
// temporal-test-kit's G1 check exercises them via fault injection (it
// substitutes chargeCardActivity's implementation at the WORKER level for
// the duration of the check — nothing about this file's own code path is
// ever actually forced to fail).

export async function reserveInventoryActivity(orderId: string): Promise<string> {
  return `reserved:${orderId}`;
}

export async function chargeCardActivity(cardNumber: string, amount: number): Promise<string> {
  return `charged:${cardNumber.slice(-4)}:${amount}`;
}

export async function shipOrderActivity(orderId: string): Promise<string> {
  return `shipped:${orderId}`;
}

export async function releaseInventoryActivity(orderId: string): Promise<string> {
  return `released:${orderId}`;
}

// --- InteractiveWorkflow's cleanup activity (fixture for H1 cancel-runs-cleanup) ---
//
// Called from InteractiveWorkflow's catch block when its finishSignal wait is
// interrupted by cancellation, before the CancelledFailure is re-thrown. H1
// confirms this actually ran by finding it in the recorded event history
// (ActivityTaskScheduled/ActivityTaskCompleted naming this activity) rather
// than trusting the workflow's own claim that it ran cleanup.
export async function cleanupActivity(reason: string): Promise<string> {
  return `cleaned:${reason}`;
}

// --- ChildWorkflow's activity (fixture for F1's fault-injection target) ---
//
// Called once at the start of ChildWorkflow, before it waits on
// childFinishSignal. F1 fault-injects this (same withFaultInjectedWorker
// technique as G1's chargeCardActivity) to force the child to fail, and
// observes how ParentWorkflow reacts.
export async function childTaskActivity(taskId: string): Promise<string> {
  return `child-task-done:${taskId}`;
}
