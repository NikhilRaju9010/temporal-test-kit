export interface StaticCheckResult {
  status: "PASS" | "FAIL";
  message: string;
  hint: string | null;
}

const UNSAFE_CALL_PATTERN = /\b(Date\.now|Math\.random)\s*\(/g;

export function checkA2NoUnsafeCode(workflowSource: string): StaticCheckResult {
  const matches = [...workflowSource.matchAll(UNSAFE_CALL_PATTERN)].map((m) => m[1]);
  if (matches.length === 0) {
    return { status: "PASS", message: "No Date.now()/Math.random() calls found in workflow code", hint: null };
  }
  return {
    status: "FAIL",
    message: `Found non-deterministic call(s) in workflow code: ${[...new Set(matches)].join(", ")}`,
    hint:
      "Non-deterministic calls inside workflow code break replay across worker restarts/upgrades. " +
      "Move this call into an Activity and call it via proxyActivities instead.",
  };
}

function extractProxyActivitiesCalls(source: string): string[] {
  const calls: string[] = [];
  const regex = /proxyActivities\s*(?:<[^>]*>)?\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i++) {
      if (source[i] === "(") depth++;
      if (source[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    calls.push(source.slice(start, end + 1));
  }
  return calls;
}

export function checkB1Timeouts(workflowSource: string): StaticCheckResult {
  const calls = extractProxyActivitiesCalls(workflowSource);
  if (calls.length === 0) {
    return { status: "PASS", message: "No proxyActivities() calls found", hint: null };
  }
  const missing = calls.filter(
    (c) => !/(startToCloseTimeout|scheduleToCloseTimeout)\s*:/.test(c),
  );
  if (missing.length === 0) {
    return { status: "PASS", message: "Every proxyActivities() call sets a timeout", hint: null };
  }
  return {
    status: "FAIL",
    message: `${missing.length} of ${calls.length} proxyActivities() call(s) have no startToCloseTimeout/scheduleToCloseTimeout`,
    hint:
      "An activity with no timeout can hang forever, blocking the workflow indefinitely. " +
      "Set startToCloseTimeout (or scheduleToCloseTimeout) on every proxyActivities() call.",
  };
}

export function checkB2RetryPolicy(workflowSource: string): StaticCheckResult {
  const calls = extractProxyActivitiesCalls(workflowSource);
  if (calls.length === 0) {
    return { status: "PASS", message: "No proxyActivities() calls found", hint: null };
  }
  const missing = calls.filter((c) => !/retry\s*:/.test(c));
  if (missing.length === 0) {
    return { status: "PASS", message: "Every proxyActivities() call configures a retry policy", hint: null };
  }
  return {
    status: "FAIL",
    message: `${missing.length} of ${calls.length} proxyActivities() call(s) have no explicit retry policy`,
    hint:
      "Without an explicit retry policy, activities use Temporal's default (effectively infinite retries), " +
      "which can retry permanent failures forever. Set a retry policy with a bounded maximumAttempts.",
  };
}
