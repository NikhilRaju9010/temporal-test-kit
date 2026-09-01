import { ScheduleOverlapPolicy } from "@temporalio/client";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { cleanupSchedule } from "../schedule-cleanup.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "D4")!;
const INTERVAL_MS = 10_000;
const WINDOW_MS = 65_000;
const MIN_EXPECTED_ACTIONS = 3;
const POLL_ATTEMPTS = 6;
const POLL_DELAY_MS = 1_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * See d2.ts for the shared D2/D3/D4 design resolution (why these checks
 * bring their own throwaway Schedule instead of querying an existing one,
 * why `features.scheduleWorkflowId` is a project-wide workflow-TYPE field,
 * and why every OTHER workflow in the loop gets a cheap SKIPPED here).
 *
 * D4 SPECIFICALLY: "missed scheduled runs are handled correctly after
 * downtime" would ideally mean taking the actual Temporal Server down for
 * real (the way L1 does for connection loss), but `TestWorkflowEnvironment`
 * exposes no pause/resume for its embedded server (confirmed while building
 * L1 — see CLAUDE.md) — so, same honesty move as L1 shipping the narrower
 * connection-loss-only check instead of blocking on the unbuildable
 * faithful one, D4 uses `ScheduleHandle.backfill()` instead of simulating
 * real downtime. Backfill isn't a workaround or a simulation of the real
 * mechanism — it IS Temporal's own real, first-class mechanism for exactly
 * this scenario ("run though the specified time period(s) and take Actions
 * as if that time passed by right now, all at once"): it is what a real
 * operator (or the schedule's own internal catch-up logic) invokes after
 * the server or a schedule was down/paused for a while. This check creates
 * a throwaway Schedule in a PAUSED state (so nothing fires "naturally"
 * during the check), then backfills a ~65-second window at a 10-second
 * interval — a window that should contain several missed occurrences — with
 * `ScheduleOverlapPolicy.ALLOW_ALL` (so the backfilled occurrences aren't
 * blocked from being counted by each other; D3 already covers overlap
 * enforcement on its own). PASS requires several actions were actually
 * taken for that backfilled window, not silently dropped. This proves
 * Temporal's OWN catch-up mechanism correctly recognizes and acts on a
 * window of missed occurrences — it does NOT prove the embedded server
 * survives an actual crash/restart (no server outage happens here at all;
 * see L1 for the same caveat applied to connection loss), and it does NOT
 * prove `scheduleWorkflowId`'s workflow behaves correctly once triggered
 * (no worker is run here either).
 */
export const checkD4MissedSchedules: DynamicFixtureCheckFn = async (env, target, features) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(features.scheduleWorkflowId)) {
    return missingFixtureResult(base, "features.scheduleWorkflowId");
  }
  const scheduleWorkflowId = features.scheduleWorkflowId as string;

  if (target.type !== scheduleWorkflowId) {
    return {
      ...base,
      status: "SKIPPED",
      message:
        `Skipped for ${target.type} — features.scheduleWorkflowId names "${scheduleWorkflowId}" as this ` +
        "project's one designated schedule-test workflow. D4 exercises that single workflow once per audit " +
        "run rather than creating a redundant throwaway schedule for every workflow this project declares.",
      hint:
        `This check already ran a real schedule test against "${scheduleWorkflowId}" elsewhere in this report. ` +
        `To test scheduling against ${target.type} instead, set features.scheduleWorkflowId to "${target.type}".`,
    };
  }

  const scheduleId = generateWorkflowId("D4", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  let handle;
  try {
    handle = await env.client.schedule.create({
      scheduleId,
      spec: { intervals: [{ every: INTERVAL_MS }] },
      action: { type: "startWorkflow", workflowType: target.type, taskQueue: target.taskQueue, args },
      policies: { overlap: ScheduleOverlapPolicy.ALLOW_ALL },
      state: { paused: true },
    });
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not create a throwaway Schedule targeting ${target.type}: ${(e as Error).message}`,
      hint:
        "This check needs to call env.client.schedule.create() against this project's ephemeral local test " +
        `server. This failure is about setting that up, not about missed-run handling itself — confirm ` +
        `${target.type} is a real exported workflow and workflows[].sampleInput (if any) matches valid JSON ` +
        "args for it.",
    };
  }

  try {
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_MS);

    try {
      await handle.backfill({ start, end, overlap: ScheduleOverlapPolicy.ALLOW_ALL });
    } catch (e) {
      return {
        ...base,
        status: "FAIL",
        message: `Could not backfill a simulated downtime window for ${target.type}'s throwaway Schedule: ${(e as Error).message}`,
        hint:
          "This check simulates a schedule catching up on missed runs via ScheduleHandle.backfill() — this " +
          "failure is about that call itself, not about the target project's code.",
      };
    }

    let description = await handle.describe();
    for (let i = 0; i < POLL_ATTEMPTS && description.info.numActionsTaken < MIN_EXPECTED_ACTIONS; i++) {
      await sleep(POLL_DELAY_MS);
      description = await handle.describe();
    }

    if (description.info.numActionsTaken < MIN_EXPECTED_ACTIONS) {
      return {
        ...base,
        status: "FAIL",
        message:
          `Backfilling a ${WINDOW_MS}ms window (${INTERVAL_MS}ms interval — several missed occurrences ` +
          `expected) resulted in only ${description.info.numActionsTaken} action(s) taken, expected at least ` +
          `${MIN_EXPECTED_ACTIONS}.`,
        hint:
          "A Schedule that doesn't take multiple actions when backfilled over a window covering several of its " +
          "own intervals means missed runs during a real downtime could be silently dropped instead of caught " +
          "up on — this is a signal about the local test server's Schedule catch-up handling, not the target " +
          "project's code.",
      };
    }

    return {
      ...base,
      status: "PASS",
      message:
        `Backfilling a ${WINDOW_MS}ms window (as if ${target.type}'s throwaway Schedule had been paused/down ` +
        `for that long) resulted in ${description.info.numActionsTaken} action(s) taken, confirming Temporal's ` +
        `own catch-up mechanism recognizes and acts on missed occurrences for ${scheduleWorkflowId} rather than ` +
        "silently dropping them. This does NOT prove the embedded test server itself survives a real " +
        "crash/restart (no server outage happens here — only a simulated backfill), and does NOT prove " +
        `${scheduleWorkflowId} behaves correctly once triggered (no worker was run against it here).`,
      hint: null,
    };
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not observe the throwaway Schedule's backfill result for ${target.type}: ${(e as Error).message}`,
      hint: "This failure is about reading back the Schedule's recorded actions, not about missed-run handling itself.",
    };
  } finally {
    await cleanupSchedule(env, handle);
  }
};
