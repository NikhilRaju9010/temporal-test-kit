import { Engine, TestResult } from "../../report/types.js";

export const DEFAULT_CHECK_TIMEOUT_MS = 15_000;

export interface CheckMeta {
  id: string;
  category: string;
  name: string;
  target: string | null;
  engine: Engine;
}

/**
 * The ONE place per-check timeout and unhandled-error/timeout-to-ERRORED
 * conversion live — a shared orchestrator concern, not something each check
 * file re-implements. Wrap every check's execution in this before adding its
 * result to a report, so a hang or a bug inside one check can never block
 * the whole audit run or get misreported as a finding about the project
 * under test.
 *
 * `fn` receives an `AbortSignal` that fires the moment this timeout expires.
 * A check that owns a live worker (via `withRunningWorker`/
 * `withFaultInjectedWorker`, forwarding this same signal) uses it to shut
 * that worker down immediately on timeout, instead of leaving it registered
 * on its task queue for the rest of the audit run while `fn`'s own abandoned
 * promise sits forever unawaited — the exact scenario that produced a real
 * "Registration of multiple workers with overlapping worker task types"
 * error from the NEXT check sharing that queue (see CLAUDE.md's now-resolved
 * "Known gap" section for the original reproduction). This function itself
 * does not wait for `fn` to actually unwind after aborting it — `fn`'s
 * result (or continued hang) no longer matters once ERRORED has been
 * reported; what matters is that downstream, whatever `fn` was holding open
 * gets torn down as soon as the signal fires.
 */
export async function runCheckWithGuards(
  fn: (signal: AbortSignal) => Promise<TestResult>,
  meta: CheckMeta,
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<TestResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } catch (e) {
    const error = e as Error;
    const timedOut = /timed out after/.test(error.message);
    return {
      id: meta.id,
      category: meta.category,
      name: meta.name,
      target: meta.target,
      engine: meta.engine,
      status: "ERRORED",
      message: `Check ${meta.id} ${timedOut ? "timed out" : "threw an unhandled error"}: ${error.message}`,
      hint: timedOut
        ? "This check did not complete within its timeout. This could mean the check itself has a bug " +
          "(forgot to resolve, missing await), or it could mean the workflow/worker under test is genuinely " +
          "hung — investigate manually before trusting either PASS or FAIL results from this check."
        : "This is a bug in temporal-test-kit's check implementation, not a finding about the project under " +
          `test. Report it against src/engines/dynamic/checks/${meta.id.toLowerCase()}.ts.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
