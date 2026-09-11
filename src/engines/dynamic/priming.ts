import { SignalConfig } from "../../config/schema.js";
import { isFixtureMissing } from "./require-fixture.js";

/**
 * The only thing priming needs from a `WorkflowHandle`. Kept structural rather
 * than importing the SDK's handle type so the unit test can drive this with a
 * plain recording fake — the point of the test is WHICH signals get sent, in
 * what order, which needs no real server.
 */
export interface SignalablePrimingHandle {
  signal(signalName: string, ...args: unknown[]): Promise<void>;
}

/**
 * Sends `workflows[].primingSignals` once, in configured order, immediately
 * after a fixture check starts its workflow and BEFORE that check begins its
 * own observation or fault injection.
 *
 * Single implementation on purpose: six checks call this, and six hand-rolled
 * copies of "loop the array and signal" is exactly the kind of duplication
 * that drifts once one of them gains a nuance the others don't.
 *
 * Absent, null, or empty `primingSignals` is a no-op — not an error and not a
 * missing-fixture result. That is what keeps every check's behavior identical
 * to before this field existed for any project that never sets it, which is
 * the property `*.test.ts`'s "sends no signals by default" cases assert
 * directly rather than by inference.
 *
 * Signals are sent sequentially rather than with `Promise.all`: a workflow
 * whose handlers build on each other (consent, then approval) can legitimately
 * depend on arrival order, and Temporal only guarantees ordering for signals
 * that are actually issued in order.
 */
export async function sendPrimingSignals(
  handle: SignalablePrimingHandle,
  primingSignals: SignalConfig[] | undefined,
): Promise<void> {
  if (isFixtureMissing(primingSignals)) return;
  for (const sig of primingSignals as SignalConfig[]) {
    await handle.signal(sig.name, sig.payload);
  }
}
