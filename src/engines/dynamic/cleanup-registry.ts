type CleanupFn = () => Promise<void> | void;

/**
 * Interrupt-safe cleanup for every disposable resource an audit run may hold
 * at once — the shared ephemeral environment, a check's own private
 * environment (I5, L1), a spawned child-process worker (I1). Before this
 * registry existed, `withEphemeralEnvironment`'s SIGINT/SIGTERM handler only
 * knew about the ONE environment it wrapped; any resource a check created on
 * its own (a private `TestWorkflowEnvironment`, a real OS child process) had
 * no path to clean-up on Ctrl+C, since `process.exit()` after the main env's
 * teardown terminates the process before a check's own `finally` block gets
 * a chance to run. Any code that owns something needing cleanup on interrupt
 * registers it here, and the SIGINT/SIGTERM handler runs the whole set via
 * `runAllCleanups()` instead of just its own resource.
 */
const cleanups = new Set<CleanupFn>();

/** Registers `fn` to run on interrupt (or whenever `runAllCleanups` is called). Returns an unregister function — call it once normal (non-interrupted) cleanup has already run, so `runAllCleanups` doesn't redo it. */
export function registerCleanup(fn: CleanupFn): () => void {
  cleanups.add(fn);
  return () => {
    cleanups.delete(fn);
  };
}

/** Runs every currently-registered cleanup (each isolated from the others' failures) and clears the registry. */
export async function runAllCleanups(): Promise<void> {
  const fns = [...cleanups];
  cleanups.clear();
  await Promise.allSettled(fns.map((fn) => Promise.resolve().then(fn)));
}
