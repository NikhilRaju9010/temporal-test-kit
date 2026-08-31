import { Status, TestResult } from "./types.js";

const STATUSES: Status[] = ["PASS", "FAIL", "SKIPPED", "N_A", "NOT_COVERED"];

export class ResultCollector {
  results: TestResult[] = [];

  add(result: TestResult): void {
    if ((result.status === "FAIL" || result.status === "SKIPPED") && !result.hint) {
      throw new Error(
        `Result ${result.id} has status ${result.status} but no hint. ` +
          "Every FAIL/SKIPPED result must include a non-empty hint.",
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
