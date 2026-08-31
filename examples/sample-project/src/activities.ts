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
