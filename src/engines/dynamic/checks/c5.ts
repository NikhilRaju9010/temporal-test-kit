import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";
import { WaitBudgetsConfig } from "../../../config/schema.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "C5")!;
const RESPONSE_WAIT_MS = 8_000;

/**
 * C5 ("Signal/update handling doesn't get the workflow stuck") needs at
 * least one signal OR update configured to have anything to exercise —
 * unlike C1-C4, it isn't gated on a single field.
 *
 * This check fires every configured signal and update in rapid, concurrent
 * succession (`Promise.all`, not sequential awaits — the whole point is
 * testing whether a burst of near-simultaneous messages can wedge the
 * workflow task loop), then confirms the workflow is still healthy
 * afterward: a query still resolves (if one is configured) within a bounded
 * wait. It deliberately does NOT wait for a `finishSignal`-style natural
 * completion — this tool has no generic way to know a target project's
 * "finish" signal name — so "still healthy" here means "still responsive to
 * a query/further interaction", not "ran to completion". Bounded via
 * `RESPONSE_WAIT_MS`, well under `runCheckWithGuards`' 15s budget, so a
 * genuinely stuck workflow reports a real FAIL rather than silently
 * consuming the whole check timeout as an ERRORED.
 */
export const checkC5NoStuckOnSignalUpdate: DynamicFixtureCheckFn = async (env, target, features, signal, waitBudgets) => {
  const responseWaitMs = waitBudgets?.C5?.responseWaitMs ?? RESPONSE_WAIT_MS;
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.signals) && isFixtureMissing(target.updates)) {
    return missingFixtureResult(base, "workflows[].signals or workflows[].updates");
  }
  const signals = target.signals ?? [];
  const updatesAllowed = features.updates === true;
  const updates = updatesAllowed ? (target.updates ?? []) : [];
  const queryName = !isFixtureMissing(target.queries) ? target.queries![0].name : null;

  const workflowId = generateWorkflowId("C5", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  try {
    return await withRunningWorker(env, target, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });

      try {
        const burst: Promise<unknown>[] = [];
        for (const sig of signals) {
          burst.push(handle.signal(sig.name, sig.payload));
          burst.push(handle.signal(sig.name, sig.payload)); // rapid re-delivery
        }
        for (const upd of updates) {
          burst.push(handle.executeUpdate(upd.name, { args: [upd.validInput] }).catch(() => {}));
        }

        const burstOutcome = await raceWithTimeout(
          Promise.allSettled(burst).then(() => "settled" as const),
          responseWaitMs,
          () => "timeout" as const,
        );

        if (burstOutcome === "timeout") {
          return {
            ...base,
            status: "FAIL" as const,
            message: `${target.type} did not finish processing a rapid burst of ${burst.length} signal/update calls within ${responseWaitMs}ms.`,
            hint:
              "A burst of near-simultaneous signals/updates shouldn't wedge the workflow task loop. This " +
              "usually points at a handler that never returns (an unresolved await inside a signal/update " +
              "handler), or a deadlock between multiple handlers touching the same state.",
          };
        }

        if (queryName) {
          const queryOutcome = await raceWithTimeout(
            handle.query(queryName).then(() => "ok" as const),
            responseWaitMs,
            () => "timeout" as const,
          );

          if (queryOutcome === "timeout") {
            return {
              ...base,
              status: "FAIL" as const,
              message: `${target.type} stopped responding to queries after a rapid burst of signal/update calls.`,
              hint:
                `${queryName} did not resolve within ${responseWaitMs}ms after the burst completed — the ` +
                "workflow task loop appears to be stuck even though the burst calls themselves returned. Check " +
                "for a handler that leaves an unresolved promise open, blocking subsequent workflow tasks.",
            };
          }
        }

        return {
          ...base,
          status: "PASS" as const,
          message:
            `${target.type} processed a rapid, concurrent burst of ${burst.length} signal/update deliveries ` +
            "without hanging" +
            (queryName ? `, and remained responsive to ${queryName} afterward.` : "."),
          hint: null,
        };
      } finally {
        await handle.cancel().catch(() => {});
      }
    }, signal);
  } catch (e) {
    return {
      ...base,
      status: "FAIL" as const,
      message: `Could not exercise ${target.type}'s configured signals/updates: ${(e as Error).message}`,
      hint:
        `This check starts ${target.type} and fires every configured workflows[].signals/updates entry in a ` +
        "rapid burst. This failure is about setting that up, not about stuck-workflow behavior itself — confirm " +
        `every configured name matches a real setHandler() registration in ${target.type}, and that ` +
        "workflows[].sampleInput is valid for it.",
    };
  }
};
