import { ScheduleOverlapPolicy } from "@temporalio/client";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { cleanupSchedule } from "../schedule-cleanup.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "D2")!;
const INTERVAL_MS = 2_000;
const EXPECTED_ACTIONS = 4;
const WAIT_MS = INTERVAL_MS * EXPECTED_ACTIONS + 2_000;
const PROMPTNESS_TOLERANCE_MS = INTERVAL_MS;

/**
 * DESIGN RESOLUTION (shared by D2/D3/D4 — see each file for the specific
 * check built on top of it):
 *
 * The spec's Appendix A comment for `scheduleWorkflowId`
 * (`"daily-rollover-schedule"`) reads like the ID of a Schedule the target
 * project already has running in its own real infrastructure — i.e.
 * "query an existing schedule" (interpretation (a)). That's not just
 * harder than "bring your own schedule" (interpretation (b), the pattern
 * G1/L2/B3 already use for fault injection) — it's IMPOSSIBLE given how
 * this tool's `env` is constructed: `withEphemeralEnvironment` always calls
 * `TestWorkflowEnvironment.createLocal()` (confirmed in `environment.ts`
 * and `cli.ts`'s `runAudit`), which boots a brand-new, unpersisted local
 * Temporal server for every audit run. There is no real infrastructure
 * behind it to have a pre-existing schedule on — `env.client.schedule.list()`
 * would always come back empty, project or no project. So (b) is the only
 * buildable interpretation, not merely the preferred one.
 *
 * That still leaves `scheduleWorkflowId`'s VALUE to define. It's a
 * `features.*` (project-wide) field, not a per-workflow one, which matches
 * how schedules are actually used in real projects: a project sets up a
 * schedule for ONE specific designated workflow (a nightly rollover, a
 * cleanup job), not generically for every workflow it happens to define.
 * So `scheduleWorkflowId` is repurposed here to mean: the WORKFLOW TYPE
 * these checks should create their own throwaway recurring Schedule
 * against. That also means the placeholder value already in
 * `examples/sample-project/temporal-test-kit.config.json`
 * (`"GreetingWorkflow"`) turns out to be a genuinely good value under this
 * interpretation, not a stale placeholder to replace: `GreetingWorkflow` is
 * the sample project's fastest, side-effect-light workflow (`await
 * condition(() => true)` resolves immediately, then one activity call) —
 * exactly the kind of workflow you'd want repeatedly, rapidly triggered by
 * a real Schedule in a short-lived test. It is left unchanged.
 *
 * Because the orchestrator (`dynamicFixtureResults` in `cli.ts`) invokes
 * every dynamic-fixture check once per `config.workflows[]` entry, not once
 * per project, each of D2/D3/D4 only runs its real Schedule test on the ONE
 * loop iteration whose `target.type` matches `features.scheduleWorkflowId`
 * — every other configured workflow gets a cheap SKIPPED explaining why (see
 * below), rather than creating a redundant throwaway schedule per workflow.
 *
 * D2 SPECIFICALLY: "fires at the right time" is fundamentally a claim about
 * the Temporal SERVER's own scheduling engine, not about the target
 * project's code — so this check never boots a worker at all. It creates a
 * short-interval throwaway Schedule (2s) with `ScheduleOverlapPolicy.ALLOW_ALL`
 * (the only policy under which multiple actions run concurrently — needed
 * here specifically so cadence can be observed without depending on any
 * workflow ever completing, since D2 makes no assumption about how long
 * `scheduleWorkflowId`'s workflow takes), waits real wall-clock time for
 * several intervals to elapse (this env is `createLocal()`, not
 * `createTimeSkipping()` — see the paragraph above — so there is no
 * time-skipping available to fast-forward this), then checks the recorded
 * `scheduledAt`/`takenAt` timestamps: were actions taken close to when they
 * were scheduled, and did enough of them happen to prove real recurrence
 * (not a one-off)? This proves the SCHEDULE fired on time — it does NOT
 * prove `scheduleWorkflowId`'s workflow behaved correctly once triggered
 * (no worker ever ran it); that's a different, business-logic-specific
 * claim this project-agnostic tool has no way to verify generically.
 */
export const checkD2SchedulesFireOnTime: DynamicFixtureCheckFn = async (env, target, features) => {
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
        "project's one designated schedule-test workflow. D2 exercises that single workflow once per audit " +
        "run rather than creating a redundant throwaway schedule for every workflow this project declares.",
      hint:
        `This check already ran a real schedule test against "${scheduleWorkflowId}" elsewhere in this report. ` +
        `To test scheduling against ${target.type} instead, set features.scheduleWorkflowId to "${target.type}".`,
    };
  }

  const scheduleId = generateWorkflowId("D2", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  let handle;
  try {
    handle = await env.client.schedule.create({
      scheduleId,
      spec: { intervals: [{ every: INTERVAL_MS }] },
      action: { type: "startWorkflow", workflowType: target.type, taskQueue: target.taskQueue, args },
      policies: { overlap: ScheduleOverlapPolicy.ALLOW_ALL },
    });
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not create a throwaway Schedule targeting ${target.type}: ${(e as Error).message}`,
      hint:
        "This check needs to call env.client.schedule.create() against this project's ephemeral local test " +
        `server. This failure is about setting that up, not about schedule timing itself — confirm ${target.type} ` +
        "is a real exported workflow and workflows[].sampleInput (if any) matches valid JSON args for it.",
    };
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    const description = await handle.describe();
    const recentActions = description.info.recentActions;

    if (recentActions.length < 2) {
      return {
        ...base,
        status: "FAIL",
        message:
          `Only ${recentActions.length} action(s) were taken by a Schedule set to fire every ${INTERVAL_MS}ms ` +
          `over a ${WAIT_MS}ms window — expected at least 2, which would confirm real recurring firing.`,
        hint:
          "A recurring Schedule that only fires once (or never) within a window many multiples of its own " +
          "interval means the Temporal server's own scheduling isn't behaving as configured — this is a signal " +
          "about the local test environment/server, not about the target project's code.",
      };
    }

    const delays = recentActions.map((a) => a.takenAt.getTime() - a.scheduledAt.getTime());
    const maxDelay = Math.max(...delays);

    if (maxDelay > PROMPTNESS_TOLERANCE_MS) {
      return {
        ...base,
        status: "FAIL",
        message:
          `A Schedule firing every ${INTERVAL_MS}ms had at least one action taken ${maxDelay}ms after its ` +
          `scheduled time (tolerance: ${PROMPTNESS_TOLERANCE_MS}ms).`,
        hint:
          "Actions taken significantly later than their scheduled time point at scheduling delay in the local " +
          "test server itself, not the target project's code — investigate independently before trusting timing" +
          "-sensitive schedules in production.",
      };
    }

    return {
      ...base,
      status: "PASS",
      message:
        `A throwaway Schedule targeting ${target.type} (every ${INTERVAL_MS}ms) took ${recentActions.length} ` +
        `actions over ${WAIT_MS}ms, each within ${maxDelay}ms of its scheduled time. This confirms Temporal's ` +
        `own scheduling engine fires ${scheduleWorkflowId} on time and recurringly — it does NOT confirm ` +
        `${scheduleWorkflowId} itself behaves correctly once triggered (no worker was run against it here; other ` +
        "checks in this report cover the workflow's own behavior once started).",
      hint: null,
    };
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not observe the throwaway Schedule's firing history for ${target.type}: ${(e as Error).message}`,
      hint: "This failure is about reading back the Schedule's recorded actions, not about scheduling timing itself.",
    };
  } finally {
    await cleanupSchedule(env, handle);
  }
};
