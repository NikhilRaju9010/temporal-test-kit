import { writeFileSync, appendFileSync } from "node:fs";

/**
 * Throwaway I1 fixture activity. Writes `startedMarkerPath` the instant it
 * begins (so the check can detect, from the parent process, exactly when
 * this activity attempt has started executing on a worker — the signal it
 * uses to trigger the SIGKILL at the right moment), sleeps `delayMs` to give
 * that kill a real window to land mid-execution, then appends one line to
 * `recordPath`. Only an attempt that runs to completion ever reaches the
 * append — an attempt killed mid-sleep leaves no trace in `recordPath`,
 * which is exactly what makes counting that file's lines afterward a
 * faithful "did the real side effect happen more than once" check across a
 * worker crash + retry. Namespaced `i1-` per CLAUDE.md's fixture convention.
 */
export async function i1RecordExecutionActivity(recordPath: string, startedMarkerPath: string, delayMs: number): Promise<string> {
  writeFileSync(startedMarkerPath, String(Date.now()));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  appendFileSync(recordPath, `${Date.now()}\n`);
  return "recorded";
}
