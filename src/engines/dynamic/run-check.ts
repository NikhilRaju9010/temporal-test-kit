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
 */
export async function runCheckWithGuards(
  fn: () => Promise<TestResult>,
  meta: CheckMeta,
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<TestResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Check timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeout]);
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
