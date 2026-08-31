import { Status, TestResult } from "./types.js";

const STATUSES: Status[] = ["PASS", "FAIL", "SKIPPED", "N_A", "NOT_COVERED", "ERRORED"];
const STATUSES_REQUIRING_HINT: Status[] = ["FAIL", "SKIPPED", "ERRORED"];

export class ResultCollector {
  results: TestResult[] = [];

  add(result: TestResult): void {
    if (STATUSES_REQUIRING_HINT.includes(result.status) && !result.hint) {
      throw new Error(
        `Result ${result.id} has status ${result.status} but no hint. ` +
          "Every FAIL/SKIPPED/ERRORED result must include a non-empty hint.",
      );
    }
    this.results.push(result);
  }

  summary(): Record<Status, number> {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    for (const result of this.results) {
      counts[result.status]++;
    }
    return counts;
  }
}
