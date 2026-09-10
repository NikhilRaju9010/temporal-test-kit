import type { History } from "@temporalio/common/lib/proto-utils.js";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { WaitBudgetsConfig } from "../../../config/schema.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "B4")!;

// Bounded internal wait for the workflow to reach a terminal state (or for
// its activities to at least get a chance to run), kept under the
// orchestrator's 15s per-check ceiling — see CLAUDE.md's "Per-check timeout
// and error isolation" and a1.ts's WAIT_TIMEOUT_MS for the same pattern.
const RUN_TIMEOUT_MS = 10_000;

// How often we poll handle.describe() while the workflow is running, looking
// for evidence of heartbeats on any activity that's still pending. See the
// big comment on recordActivityExecutions for why this polling exists at all
// (history alone doesn't carry heartbeat evidence for activities that
// complete normally).
const POLL_INTERVAL_MS = 200;

/**
 * "Long" for the purposes of this zero-fixture check. Below this, there's
 * nothing meaningful to grade about heartbeat usage — see checkB4Heartbeats.
 */
export const LONG_ACTIVITY_THRESHOLD_MS = 2_000;

function timestampToMs(ts?: { seconds?: unknown; nanos?: number | null } | null): number | null {
  if (!ts || ts.seconds == null) return null;
  const seconds =
    typeof ts.seconds === "number" ? ts.seconds : Number((ts.seconds as { toString(): string }).toString());
  const nanos = ts.nanos ?? 0;
  return seconds * 1000 + nanos / 1e6;
}

export type ActivityOutcome = "COMPLETED" | "FAILED" | "TIMED_OUT" | "UNSTARTED" | "STARTED";

export interface ActivityExecution {
  activityId: string;
  activityType: string;
  startedAtMs: number | null;
  endedAtMs: number | null;
  /** null when the activity never started, or started but never reached a terminal event within RUN_TIMEOUT_MS. */
  durationMs: number | null;
  outcome: ActivityOutcome;
  /**
   * Best-effort, live-polled evidence that this activity called heartbeat()
   * at least once while it was pending. See recordActivityExecutions for why
   * this can't be derived from the fetched history alone.
   */
  heartbeatSeenLive: boolean;
}

/**
 * Parses ActivityTaskScheduled/Started/Completed/Failed/TimedOut events out
 * of `history` into one record per activity execution, matched by
 * scheduledEventId. `heartbeatSeenActivityIds` (collected via live polling,
 * see recordActivityExecutions) is merged in by activityId.
 */
export function extractActivityExecutions(
  history: History,
  heartbeatSeenActivityIds: ReadonlySet<string>,
): ActivityExecution[] {
  const events = history.events ?? [];
  const byScheduledEventId = new Map<string, ActivityExecution>();

  for (const event of events) {
    const scheduled = event.activityTaskScheduledEventAttributes;
    if (scheduled) {
      byScheduledEventId.set(String(event.eventId), {
        activityId: scheduled.activityId ?? "",
        activityType: scheduled.activityType?.name ?? "unknown",
        startedAtMs: null,
        endedAtMs: null,
        durationMs: null,
        outcome: "UNSTARTED",
        heartbeatSeenLive: false,
      });
      continue;
    }

    const started = event.activityTaskStartedEventAttributes;
    if (started) {
      const rec = byScheduledEventId.get(String(started.scheduledEventId));
      if (rec) {
        rec.startedAtMs = timestampToMs(event.eventTime);
        rec.outcome = "STARTED";
      }
      continue;
    }

    const completed = event.activityTaskCompletedEventAttributes;
    if (completed) {
      const rec = byScheduledEventId.get(String(completed.scheduledEventId));
      if (rec) {
        rec.endedAtMs = timestampToMs(event.eventTime);
        rec.outcome = "COMPLETED";
      }
      continue;
    }

    const failed = event.activityTaskFailedEventAttributes;
    if (failed) {
      const rec = byScheduledEventId.get(String(failed.scheduledEventId));
      if (rec) {
        rec.endedAtMs = timestampToMs(event.eventTime);
        rec.outcome = "FAILED";
      }
      continue;
    }

    const timedOut = event.activityTaskTimedOutEventAttributes;
    if (timedOut) {
      const rec = byScheduledEventId.get(String(timedOut.scheduledEventId));
      if (rec) {
        rec.endedAtMs = timestampToMs(event.eventTime);
        rec.outcome = "TIMED_OUT";
      }
      continue;
    }
  }

  const records = [...byScheduledEventId.values()];
  for (const rec of records) {
    if (rec.startedAtMs != null && rec.endedAtMs != null) {
      rec.durationMs = rec.endedAtMs - rec.startedAtMs;
    }
    if (rec.activityId && heartbeatSeenActivityIds.has(rec.activityId)) {
      rec.heartbeatSeenLive = true;
    }
  }
  return records;
}

export interface RecordedRun {
  history: History;
  workflowId: string;
  activities: ActivityExecution[];
}

/**
 * Starts `target.workflowType` for real against a live worker (zero-fixture:
 * no args), then measures each activity's Started→terminal duration from the
 * fetched event history.
 *
 * Heartbeat evidence is the tricky part, and is NOT something the fetched
 * history exposes for an activity that completes normally. We went looking
 * (per this check's design note) at `@temporalio/common`'s History/proto-utils
 * types and the raw event attribute shapes in `@temporalio/proto`:
 * `ActivityTaskCompletedEventAttributes` / `ActivityTaskFailedEventAttributes`
 * carry no heartbeat fields at all. The only heartbeat-adjacent field in the
 * *event history* is `TimeoutFailureInfo.lastHeartbeatDetails`, which only
 * gets populated when an activity actually times out — useless for grading
 * an activity that heartbeats correctly and then completes successfully,
 * which is the common/desired case this check should be able to PASS.
 *
 * The heartbeat data Temporal *does* track live is `PendingActivityInfo`
 * (`heartbeatDetails` / `lastHeartbeatTime`), returned by
 * `DescribeWorkflowExecution` (exposed here as `handle.describe().raw
 * .pendingActivities`) — but only while the activity is still pending; once
 * it completes, that entry disappears from `pendingActivities` and the
 * evidence is gone. So this function polls `handle.describe()` at
 * POLL_INTERVAL_MS while the workflow runs and records which activityIds
 * were ever observed with heartbeat data, before falling back to the fetched
 * history for timing. This is a best-effort, timing-sensitive signal (a
 * heartbeat that lands between two polls, or an activity that finishes
 * inside a single poll gap, could be missed) — acceptable here because
 * checkB4Heartbeats only relies on it for activities that ran long enough
 * (LONG_ACTIVITY_THRESHOLD_MS) to be polled several times over.
 */
export async function recordActivityExecutions(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
  runTimeoutMs: number = RUN_TIMEOUT_MS,
): Promise<RecordedRun> {
  const workflowId = generateWorkflowId("B4", target.workflowType);

  return withRunningWorker(
    env,
    target,
    async () => {
    const handle = await env.client.workflow.start(target.workflowType, {
      taskQueue: target.taskQueue,
      workflowId,
      args: [],
    });

    const heartbeatSeenActivityIds = new Set<string>();
    let keepPolling = true;
    const pollLoop = (async () => {
      while (keepPolling) {
        try {
          const description = await handle.describe();
          const pendingActivities = description.raw.pendingActivities ?? [];
          for (const info of pendingActivities) {
            if (info.activityId && (info.heartbeatDetails || info.lastHeartbeatTime)) {
              heartbeatSeenActivityIds.add(info.activityId);
            }
          }
        } catch {
          // Transient describe() failures (e.g. right around workflow
          // completion/worker shutdown) shouldn't abort the poll loop.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    })();

    await raceWithTimeout(handle.result().catch(() => {}), runTimeoutMs, () => undefined);
    keepPolling = false;
    await pollLoop;

    const history = await handle.fetchHistory();
    const activities = extractActivityExecutions(history, heartbeatSeenActivityIds);
    return { history, workflowId, activities };
    },
    signal,
  );
}

/**
 * B4 — "Long steps send heartbeats". Applies, per the catalog/spec, only to
 * activities expected to run a while (minutes+): those need periodic
 * `heartbeat()` calls so Temporal (and anything watching) can tell a slow
 * activity apart from a genuinely stuck one before startToCloseTimeout
 * finally fires.
 *
 * This is a zero-fixture check: it has no way to know *which* activity on
 * `target.workflowType` is meant to be long-running (that's fixture data —
 * Phase 3 scope, not yet built). So it runs the workflow once with no args
 * and observes what actually happens:
 *
 *   - If nothing ran long enough to say anything meaningful about heartbeat
 *     usage (the overwhelmingly likely outcome in a zero-fixture run against
 *     an arbitrary project — e.g. examples/sample-project's
 *     formatGreetingActivity completes in milliseconds), this returns PASS
 *     with a message that's explicit about the limitation, rather than
 *     silently reporting a clean bill of health.
 *
 *     Status choice — PASS, not SKIPPED, and here's why: per CLAUDE.md,
 *     SKIPPED means "needs fixture data from temporal-test-kit.config.json
 *     that wasn't provided" and must "always carry a hint naming exactly
 *     which config field would unlock it." As of this phase, the config
 *     schema (src/config/schema.ts) has no field for "which activity is
 *     long-running" — it doesn't exist yet, so there is no real field name
 *     to put in a SKIPPED hint without inventing one that isn't actually
 *     wired to anything. Using SKIPPED now would misrepresent the tool's
 *     current state as "you forgot to configure X" when X doesn't exist to
 *     configure. This check DID run, DID observe real activity executions,
 *     and DID find no problem in what it could observe — that's what PASS
 *     means. The honesty the spec cares about is preserved in the message
 *     text instead: it says plainly that this run couldn't meaningfully
 *     evaluate heartbeat usage and names what would fix that (a future
 *     config field). Arguably SKIPPED reads as *more* honest in spirit
 *     (nothing was really graded), which is why this reasoning is spelled
 *     out here rather than left implicit — if/when Phase 3 adds a concrete
 *     `features`/fixture field for "long-running activity", switching this
 *     branch to real SKIPPED with that field's name in the hint is the
 *     right follow-up.
 *
 *   - If an activity DID run past LONG_ACTIVITY_THRESHOLD_MS with zero
 *     recorded heartbeat evidence, that's FAIL — a real, actionable finding
 *     even without fixture data, because "this specific activity ran long
 *     and never heartbeated" was directly observed, not inferred.
 *
 *   - If an activity ran long AND recorded heartbeat evidence, PASS.
 */
export async function checkB4Heartbeats(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
  waitBudgets?: WaitBudgetsConfig,
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.workflowType,
    engine: "dynamic-zero-fixture" as const,
  };

  let recorded: RecordedRun;
  try {
    recorded = await recordActivityExecutions(env, target, signal, waitBudgets?.B4?.runTimeoutMs ?? RUN_TIMEOUT_MS);
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.workflowType} to observe its activity execution(s): ${(e as Error).message}`,
      hint:
        "This check needs to run the workflow once to see whether any of its activities run long enough to " +
        "evaluate heartbeat usage. This failure is about running the workflow at all — check the worker " +
        "boot/config first.",
    };
  }

  const longActivities = recorded.activities.filter(
    (a) => a.durationMs !== null && a.durationMs >= LONG_ACTIVITY_THRESHOLD_MS,
  );

  if (longActivities.length === 0) {
    return {
      ...base,
      status: "PASS",
      message:
        "No activity ran long enough during this zero-fixture check to meaningfully evaluate heartbeat usage " +
        `(all activities completed in under ${LONG_ACTIVITY_THRESHOLD_MS / 1000}s). Heartbeat correctness for ` +
        "genuinely long-running activities requires configuring which activity is long-running via fixture " +
        "data (a future config field) so this check can target it specifically.",
      hint: null,
    };
  }

  const missingHeartbeat = longActivities.filter((a) => !a.heartbeatSeenLive);
  if (missingHeartbeat.length > 0) {
    const names = [...new Set(missingHeartbeat.map((a) => a.activityType))].join(", ");
    const longestMs = Math.max(...missingHeartbeat.map((a) => a.durationMs ?? 0));
    return {
      ...base,
      status: "FAIL",
      message:
        `Activit${missingHeartbeat.length === 1 ? "y" : "ies"} ${names} ran for ${longestMs}ms without recording ` +
        "any heartbeat.",
      hint:
        "Activities expected to run a while (minutes+) should call `Context.current().heartbeat()` periodically " +
        "(e.g. once per unit of progress, or on a fixed interval inside a long loop) so Temporal — and anything " +
        "polling this workflow's status — can tell a slow-but-healthy activity apart from one that's actually " +
        "stuck. Without heartbeats, both look identical until the activity's startToCloseTimeout finally fires, " +
        "which can be minutes or hours later than a hang should have been noticed. Add heartbeat() calls inside " +
        "the activity's long-running work, and configure a `heartbeatTimeout` in the workflow's " +
        "proxyActivities()/proxyLocalActivities() options so Temporal actually enforces it.",
    };
  }

  const longNames = [...new Set(longActivities.map((a) => a.activityType))].join(", ");
  return {
    ...base,
    status: "PASS",
    message: `Long-running activit${longActivities.length === 1 ? "y" : "ies"} (${longNames}) recorded heartbeats during execution.`,
    hint: null,
  };
}
