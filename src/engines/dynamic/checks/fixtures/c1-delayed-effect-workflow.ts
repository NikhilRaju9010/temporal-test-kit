import { condition, defineSignal, defineQuery, setHandler, sleep } from "@temporalio/workflow";

/**
 * Fixture for C1's poll-until-change fix. `pingSignal`'s handler mutates
 * queryable state only after an `await sleep(...)` — mirroring a real
 * project's signal handler that kicks off async work (an activity call,
 * typically) before the effect becomes visible via query, exactly the
 * shape that made a single before/after snapshot taken immediately after
 * `handle.signal()` resolves a false FAIL: `signal()` only waits for the
 * SERVER to accept the signal, not for the WORKER to actually run the
 * handler to completion.
 */
export const pingSignal = defineSignal("pingSignal");
export const getCounterQuery = defineQuery<number>("getCounterQuery");

export async function GreetingWorkflow(): Promise<string> {
  let counter = 0;
  let finished = false;

  setHandler(pingSignal, async () => {
    await sleep("300ms");
    counter += 1;
  });
  setHandler(getCounterQuery, () => counter);

  await condition(() => finished);
  return "unreachable";
}
