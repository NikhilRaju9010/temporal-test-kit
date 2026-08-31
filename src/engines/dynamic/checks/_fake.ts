import { TestResult, Status } from "../../../report/types.js";

/**
 * Throwaway check used only to prove the report pipeline renders all five
 * statuses end-to-end. Not part of the 49-test catalog. Delete once real
 * checks (Phase 2b) exercise every status naturally.
 */
export function runFakeCheck(forcedStatus: Status): TestResult {
  const hint = forcedStatus === "FAIL" || forcedStatus === "SKIPPED" ? "This is a fake check; the hint text is a placeholder." : null;
  return {
    id: "FAKE1",
    category: "Fake",
    name: "Trivial pipeline-proof check",
    status: forcedStatus,
    target: null,
    message: `Forced to ${forcedStatus} to prove the report pipeline`,
    hint,
    engine: "dynamic-zero-fixture",
  };
}
