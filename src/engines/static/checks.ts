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

/** Extracts every match of `openPattern` (which must end in a literal `(` or `{`) as a balanced-bracket block starting at that opener — shared by proxyActivities/proxyLocalActivities call extraction and by pulling a nested `retry: {...}` object out of one of those calls. */
function extractBalancedBlocks(source: string, openPattern: RegExp): string[] {
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = openPattern.exec(source)) !== null) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i++) {
      if (source[i] === "(" || source[i] === "{") depth++;
      if (source[i] === ")" || source[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push(source.slice(start, end + 1));
  }
  return blocks;
}

function extractProxyActivitiesCalls(source: string): string[] {
  return extractBalancedBlocks(source, /proxyActivities\s*(?:<[^>]*>)?\s*\(/g);
}

function extractProxyLocalActivitiesCalls(source: string): string[] {
  return extractBalancedBlocks(source, /proxyLocalActivities\s*(?:<[^>]*>)?\s*\(/g);
}

/** Pulls the contents of a call's own `retry: {...}` object, if any. */
function extractRetryBlock(call: string): string | null {
  return extractBalancedBlocks(call, /retry\s*:\s*\{/g)[0] ?? null;
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

/** Local Activities run inline inside a workflow task with no independent retry-across-task-boundary and no heartbeat support — they're meant to complete quickly, well under a workflow task's own timeout (10s by default). */
const LOCAL_ACTIVITY_MAX_DURATION_MS = 10_000;

function parseDurationToMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("ms") || unit.startsWith("milli")) return value;
  if (unit.startsWith("h")) return value * 3_600_000;
  if (unit.startsWith("m") && !unit.startsWith("ms")) return value * 60_000;
  return value * 1000;
}

function extractTimeoutMs(call: string): number | null {
  const quoted = call.match(/(?:startToCloseTimeout|scheduleToCloseTimeout)\s*:\s*(['"`])([^'"`]+)\1/);
  if (quoted) return parseDurationToMs(quoted[2]);
  const numeric = call.match(/(?:startToCloseTimeout|scheduleToCloseTimeout)\s*:\s*(\d+)/);
  if (numeric) return Number(numeric[1]);
  return null;
}

export function checkB6LocalActivitiesAreShort(workflowSource: string): StaticCheckResult {
  const calls = extractProxyLocalActivitiesCalls(workflowSource);
  if (calls.length === 0) {
    return { status: "PASS", message: "No proxyLocalActivities() calls found", hint: null };
  }
  const tooLong = calls.filter((c) => {
    const ms = extractTimeoutMs(c);
    return ms === null || ms > LOCAL_ACTIVITY_MAX_DURATION_MS;
  });
  if (tooLong.length === 0) {
    return {
      status: "PASS",
      message: `Every proxyLocalActivities() call is configured with a short (<= ${LOCAL_ACTIVITY_MAX_DURATION_MS / 1000}s) timeout`,
      hint: null,
    };
  }
  return {
    status: "FAIL",
    message: `${tooLong.length} of ${calls.length} proxyLocalActivities() call(s) have no timeout, or a timeout longer than ${LOCAL_ACTIVITY_MAX_DURATION_MS / 1000}s`,
    hint:
      "Local Activities execute inline inside a workflow task with no independent retry-across-task-boundary or " +
      "heartbeat support, so a long-running one can itself cause workflow task timeouts. Reserve them for short, " +
      "simple, fast operations (well under the workflow task timeout) — move anything longer or more complex to " +
      "a regular Activity via proxyActivities instead.",
  };
}

function isRetryBounded(retryBlock: string): boolean {
  const maxAttempts = retryBlock.match(/maximumAttempts\s*:\s*(\d+)/);
  const boundedAttempts = maxAttempts !== null && Number(maxAttempts[1]) > 0;
  const hasNonRetryableTypes = /nonRetryableErrorTypes\s*:/.test(retryBlock);
  return boundedAttempts || hasNonRetryableTypes;
}

export function checkG2PermanentFailuresDontRetryForever(workflowSource: string): StaticCheckResult {
  const calls = extractProxyActivitiesCalls(workflowSource);
  const retryBlocks = calls.map(extractRetryBlock).filter((b): b is string => b !== null);

  if (retryBlocks.length === 0) {
    return {
      status: "PASS",
      message: "No explicit retry policies configured to evaluate for boundedness (see B2 for whether a retry policy is configured at all)",
      hint: null,
    };
  }

  const unbounded = retryBlocks.filter((b) => !isRetryBounded(b));
  if (unbounded.length === 0) {
    return {
      status: "PASS",
      message: "Every configured retry policy bounds retries (maximumAttempts or nonRetryableErrorTypes) — permanent failures won't retry forever",
      hint: null,
    };
  }
  return {
    status: "FAIL",
    message: `${unbounded.length} of ${retryBlocks.length} configured retry polic(ies) set neither a finite maximumAttempts nor nonRetryableErrorTypes`,
    hint:
      "A retry policy with no maximumAttempts and no nonRetryableErrorTypes retries EVERY failure indefinitely, " +
      "including permanent ones (bad input, a 4xx from a downstream service) that will never succeed no matter " +
      "how many times they're retried. Set a bounded maximumAttempts and/or classify permanent failures via " +
      "nonRetryableErrorTypes, or by throwing a non-retryable ApplicationFailure.",
  };
}
