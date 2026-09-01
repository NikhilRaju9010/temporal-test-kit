/**
 * Races `promise` against a timeout, resolving with `onTimeout()`'s value if
 * the timeout wins. Unlike a bare `Promise.race([promise, new
 * Promise(resolve => setTimeout(resolve, ms))])`, this clears the timer on
 * whichever side wins — the bare pattern leaves the loser's `setTimeout`
 * running regardless, a dangling timer that fires later on its own schedule
 * with nothing left to do. Under full-suite concurrency that's been
 * confirmed to produce a real "Channel has been shut down" gRPC error (a
 * stale timer firing after some OTHER test file's `env.teardown()` already
 * ran) and, in the worst case, real orphaned `temporal-sdk-typescript`
 * ephemeral-server OS processes (see CLAUDE.md's now-resolved "Known
 * follow-up cleanup" section for the original diagnosis).
 */
export function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T | PromiseLike<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
