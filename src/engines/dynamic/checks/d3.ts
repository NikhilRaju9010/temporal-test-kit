import { ScheduleOverlapPolicy } from "@temporalio/client";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { cleanupSchedule } from "../schedule-cleanup.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "D3")!;
const INTERVAL_MS = 2_000;
const NUM_INTERVALS_TO_WAIT = 4;
const WAIT_MS = INTERVAL_MS * NUM_INTERVALS_TO_WAIT + 2_000;

/**
 * See d2.ts for the shared D2/D3/D4 design resolution (why these checks
 * bring their own throwaway Schedule instead of querying an existing one,
 * why `features.scheduleWorkflowId` is a project-wide workflow-TYPE field,
 * and why every OTHER workflow in the loop gets a cheap SKIPPED here).
 *
 * D3 SPECIFICALLY: "overlapping scheduled runs are handled correctly" has
 * no config field naming which overlap policy a project actually wants in
 * production (the spec's Appendix A has no such field, and none was added
 * here — see schema.ts), so — same honesty move as B3 picking one specific,
 * narrower, provable claim over an unprovable general one — this check
 * verifies ONE concrete, generic, fully-provable claim: does Temporal
 * correctly enforce `ScheduleOverlapPolicy.SKIP` (the SDK's own default
 * policy, so also the policy any project gets if it never sets one)? A
 * throwaway Schedule is created with SKIP and a short interval, and — unlike
 * D2 — deliberately WITHOUT a worker for the whole wait, so the first
 * triggered execution never completes and stays open the entire time. That
 * is what forces a genuine overlap condition deterministically, without
 * needing to know or control how long `scheduleWorkflowId`'s own workflow
 * takes to run: every subsequent interval fires while the first execution
 * is still "Running", which is exactly the scenario SKIP exists to handle.
 * PASS requires BOTH that exactly one action was actually taken (not zero,
 * not more than one — more than one would mean SKIP let two concurrent runs
 * through, which SKIP must never do) AND that later intervals were recorded
 * as skipped-due-to-overlap (`numActionsSkippedOverlap`) rather than
 * silently vanishing. This proves the SKIP overlap policy itself is
 * enforced correctly by the Temporal server — it does NOT test
 * BUFFER_ONE/BUFFER_ALL/CANCEL_OTHER/TERMINATE_OTHER/ALLOW_ALL, since no
 * fixture tells this tool which of those (if any) a given project actually
 * relies on.
 */
export const checkD3OverlappingSchedules: DynamicFixtureCheckFn = async (env, target, features) => {
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
        "project's one designated schedule-test workflow. D3 exercises that single workflow once per audit " +
        "run rather than creating a redundant throwaway schedule for every workflow this project declares.",
      hint:
        `This check already ran a real schedule test against "${scheduleWorkflowId}" elsewhere in this report. ` +
        `To test scheduling against ${target.type} instead, set features.scheduleWorkflowId to "${target.type}".`,
    };
  }

  const scheduleId = generateWorkflowId("D3", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  let handle;
  try {
    handle = await env.client.schedule.create({
      scheduleId,
      spec: { intervals: [{ every: INTERVAL_MS }] },
      action: { type: "startWorkflow", workflowType: target.type, taskQueue: target.taskQueue, args },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
    });
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not create a throwaway Schedule targeting ${target.type}: ${(e as Error).message}`,
      hint:
        "This check needs to call env.client.schedule.create() against this project's ephemeral local test " +
        `server. This failure is about setting that up, not about overlap handling itself — confirm ${target.type} ` +
        "is a real exported workflow and workflows[].sampleInput (if any) matches valid JSON args for it.",
    };
  }

  try {
    // No worker is ever booted against target.taskQueue here — deliberately.
    // With nothing polling the queue, the first action's workflow execution
    // never completes, so every later interval genuinely collides with a
    // still-open run and SKIP has something real to enforce.
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    const description = await handle.describe();
    const { numActionsTaken, numActionsSkippedOverlap } = description.info;

    if (numActionsTaken !== 1) {
      return {
        ...base,
        status: "FAIL",
        message:
          `A Schedule with ScheduleOverlapPolicy.SKIP took ${numActionsTaken} action(s) while its first ` +
          `triggered execution was still open, over a window covering ~${NUM_INTERVALS_TO_WAIT} of its ` +
          `${INTERVAL_MS}ms intervals — expected exactly 1.`,
        hint:
          numActionsTaken > 1
            ? "More than one action ran concurrently under SKIP, which should never start a new action while " +
              "the previous one is still running — this points at a scheduling/overlap bug in the local test " +
              "server, not the target project's code."
            : "Zero actions were taken at all, so this run can't tell you anything about overlap handling — " +
              "confirm the throwaway Schedule was actually created against a reachable task queue.",
      };
    }

    if (numActionsSkippedOverlap < 1) {
      return {
        ...base,
        status: "FAIL",
        message:
          "Exactly one action ran (as expected), but numActionsSkippedOverlap is 0 even though later intervals " +
          "should have collided with the still-open first execution and been correctly skipped rather than " +
          "silently dropped or never evaluated.",
        hint:
          "A Schedule under SKIP should report every interval it deliberately skipped due to overlap via " +
          "numActionsSkippedOverlap, not just silently do nothing — this is a signal about the local test " +
          "server's Schedule accounting, not the target project's code.",
      };
    }

    return {
      ...base,
      status: "PASS",
      message:
        `A throwaway Schedule targeting ${target.type} with ScheduleOverlapPolicy.SKIP took exactly 1 action ` +
        `while that execution stayed open (no worker was run), and correctly recorded ` +
        `${numActionsSkippedOverlap} later interval(s) as skipped-due-to-overlap rather than starting a second ` +
        "concurrent run. This confirms Temporal enforces the SKIP overlap policy correctly for " +
        `${scheduleWorkflowId} — it does NOT confirm BUFFER_ONE/BUFFER_ALL/CANCEL_OTHER/TERMINATE_OTHER/ALLOW_ALL ` +
        "behave correctly, since no fixture tells this tool which overlap policy this project actually relies on.",
      hint: null,
    };
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not observe the throwaway Schedule's overlap history for ${target.type}: ${(e as Error).message}`,
      hint: "This failure is about reading back the Schedule's recorded actions, not about overlap handling itself.",
    };
  } finally {
    await cleanupSchedule(env, handle);
  }
};
