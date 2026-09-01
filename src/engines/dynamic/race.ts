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
  const timeout = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      // onTimeout() is allowed to throw synchronously (the "reject on
      // timeout" usage — see c1.ts/d1.ts/i1.ts/e2.ts) as well as resolve. A
      // throw here happens inside a setTimeout callback, which is NOT
      // connected to this Promise executor's try/catch — left uncaught, it
      // would surface as an unhandled exception while this timeout promise
      // itself hangs forever unresolved, defeating the entire point of a
      // bounded wait. Must be caught and turned into a real rejection.
      try {
        resolve(onTimeout());
      } catch (e) {
        reject(e);
      }
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
