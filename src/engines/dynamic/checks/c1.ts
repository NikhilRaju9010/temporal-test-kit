import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "C1")!;
const QUERY_WAIT_MS = 5_000;

/**
 * C1 starts the workflow, sends each configured `workflows[].signals[]`
 * entry, then re-sends the FIRST one a second time (the "duplicate/late
 * signal" half of the catalog name). It confirms delivery the only fully
 * generic way this tool can: via a configured query (`workflows[].queries[]`)
 * showing observably different state before vs. after. If no query is
 * configured, this check can only prove the client-side `signal()` calls
 * didn't error — NOT that the workflow actually did anything with them
 * (an unhandled signal name is silently accepted by Temporal, not
 * rejected) — and says so explicitly in the PASS message, same honesty
 * treatment as B3/G1's narrower-than-the-name bars.
 *
 * Whether a duplicate signal SHOULD double-apply is a project-specific
 * design decision this tool can't judge generically (a counter-style
 * handler applying twice is correct; a "set exactly once" handler applying
 * twice might not be) — so this check only asserts the duplicate delivery
 * doesn't error and doesn't leave the workflow stuck, and reports what
 * actually happened to the query result as informational context, not a
 * pass/fail bar by itself.
 */
export const checkC1Signals: DynamicFixtureCheckFn = async (env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.signals)) {
    return missingFixtureResult(base, "workflows[].signals");
  }
  const signals = target.signals!;
  const queryName = !isFixtureMissing(target.queries) ? target.queries![0].name : null;

  const workflowId = generateWorkflowId("C1", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  try {
    return await withRunningWorker(env, target, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });

      try {
        const beforeState = queryName
          ? await raceWithTimeout(handle.query(queryName), QUERY_WAIT_MS, () => {
              throw new Error(`query ${queryName} did not resolve within ${QUERY_WAIT_MS}ms`);
            })
          : null;

        for (const sig of signals) {
          await handle.signal(sig.name, sig.payload);
        }
        // Re-send the first configured signal a second time — the
        // duplicate/late-signal half of this check's catalog name.
        const dup = signals[0];
        await handle.signal(dup.name, dup.payload);

        if (!queryName) {
          return {
            ...base,
            status: "PASS" as const,
            message:
              `Sent ${signals.length} configured signal(s) to ${target.type} (including a duplicate of ` +
              `"${dup.name}") with no client-side error. No workflows[].queries entry is configured, so this ` +
              "check can ONLY prove the signal() calls didn't error — it has no way to confirm the workflow " +
              "actually observed or acted on any of them (Temporal silently accepts a signal for a name the " +
              "workflow has no handler for). Configure workflows[].queries to unlock the stronger version of " +
              "this check.",
            hint: null,
          };
        }

        const afterState = await raceWithTimeout(handle.query(queryName), QUERY_WAIT_MS, () => {
          throw new Error(`query ${queryName} did not resolve within ${QUERY_WAIT_MS}ms`);
        });

        if (JSON.stringify(afterState) === JSON.stringify(beforeState)) {
          return {
            ...base,
            status: "FAIL" as const,
            message:
              `${queryName} returned identical state before and after sending ${signals.length} configured ` +
              `signal(s) to ${target.type} — the signal(s) don't appear to have reached a real handler.`,
            hint:
              `Confirm each name in workflows[].signals is actually registered via setHandler() in ${target.type}, ` +
              `and that ${queryName} reads state a signal handler actually mutates. A signal Temporal accepts but ` +
              "the workflow silently ignores looks identical to a working one from the client's point of view — " +
              "this check only catches it because the query shows no observable effect.",
          };
        }

        return {
          ...base,
          status: "PASS" as const,
          message:
            `Sent ${signals.length} configured signal(s) to ${target.type}, including a duplicate delivery of ` +
            `"${dup.name}", and confirmed via ${queryName} that state changed as a result. The duplicate delivery ` +
            "did not error and did not leave the workflow stuck. This check does not judge whether re-applying a " +
            "signal's effect a second time is itself correct — that's a project-specific design decision (a " +
            "counter-style handler applying twice is fine; a set-once handler might not be) this generic tool " +
            "has no way to evaluate.",
          hint: null,
        };
      } finally {
        await handle.cancel().catch(() => {});
      }
    });
  } catch (e) {
    return {
      ...base,
      status: "FAIL" as const,
      message: `Could not exercise ${target.type}'s configured signals: ${(e as Error).message}`,
      hint:
        `This check starts ${target.type} and sends each entry in workflows[].signals by name via the client. ` +
        "This failure is about setting that up (worker boot, workflow start, or the signal/query call itself), " +
        "not about signal-handling behavior — confirm every configured signal/query name matches a real " +
        `setHandler() registration in ${target.type}, and that workflows[].sampleInput is valid for it.`,
    };
  }
};
