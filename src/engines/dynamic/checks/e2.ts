import proto from "@temporalio/proto";
import { arrayFromPayloads, defaultPayloadConverter } from "@temporalio/common";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "E2")!;

/**
 * `Promise.race([promise, timeoutPromise])` alone leaves the LOSING side's
 * `setTimeout` uncleared when `promise` wins — a dangling timer that fires
 * later regardless. Harmless on its own, but chained across several calls
 * in this check's loop, those uncleared timers piled up and outlived
 * `env.teardown()` in practice (observed as an unhandled "Channel has been
 * shut down" gRPC error attributed to whichever test happened to be
 * running when a stale timer's callback finally fired) — always clear the
 * timer on whichever side wins.
 */
function raceWithTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T | PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// How many times this check sends the configured signal before giving up
// waiting for a WorkflowExecutionContinuedAsNew event to show up. This is a
// real, documented limitation: unlike E1 (which brings its own probe
// workflow and controls exactly when it resets), E2 has to drive the
// TARGET project's own workflow toward its own, unknown-to-this-tool reset
// threshold using only the generic signal it's been given. sample-project's
// CounterWorkflow resets after 3 increments; this budget gives real
// projects a couple of multiples of headroom while staying well inside the
// per-check timeout (see CLAUDE.md "Per-check timeout and error isolation").
// If a project's workflow genuinely needs more signals than this to reset,
// this check reports that honestly as a FAIL naming the limitation, not a
// false PASS or a silent hang.
//
// Set generously above sample-project's own 9-signal (3 cycles x 3
// increments) minimum: confirmed empirically that Temporal can silently
// drop a signal delivered right at a continueAsNew boundary (a documented
// SDK/protocol caveat, not a bug in this check or the fixture) — observed
// runs needing anywhere from 9 to 12 deliveries to actually finish. This
// check's own "remaining budget" loop already stops as soon as signal()
// itself starts erroring (workflow already completed), so a generous
// budget only costs a few extra no-op sends on a lucky run, never extra
// wall-clock time waiting.
const SIGNAL_BUDGET = 20;
const QUERY_WAIT_MS = 5_000;
const RESULT_WAIT_MS = 10_000;
// A zero-delay, back-to-back signal()+fetchHistory() loop (up to
// SIGNAL_BUDGET iterations) turned out to trigger a transient gRPC hiccup
// often enough to matter — grpc-js schedules an internal backoff retry
// (@temporalio/client's grpc-retry.ts) that can still be pending when the
// loop finishes and the surrounding test/check tears its environment down
// shortly after, surfacing as an unhandled "Channel has been shut down"
// error attributed to whatever runs next. A small pace between iterations
// (matching CHILD_START_POLL_INTERVAL_MS's role in f1.ts/f2.ts/h3.ts) fixed
// it in practice, and is the right call anyway — a tight zero-delay poll
// loop is unnecessary load on the server regardless.
const DISCOVERY_POLL_INTERVAL_MS = 150;

/**
 * E2 verifies that a project's OWN accumulated workflow state survives a
 * Continue-As-New reset — distinct from E1, which only proves the generic
 * mechanism fires using a throwaway internal probe that carries no
 * meaningful state across its own reset (see e1.ts's doc comment). E2 needs
 * real project code with something actually at stake: a signal that
 * mutates accumulated state (`workflows[].signals`, the same fixture C1
 * uses) is required — without one, there's nothing for this check to
 * accumulate or lose, so it's gated SKIPPED the same way C1 is when that
 * fixture is missing, in addition to the pre-existing `isLongRunning`
 * gate.
 *
 * Protocol:
 *   1. Start the workflow with `sampleInput`, capture a baseline via the
 *      configured query (if any) — same optional-query treatment as C1.
 *   2. Send the configured signal up to SIGNAL_BUDGET times, checking after
 *      each send whether the FIRST execution's history now contains a
 *      WorkflowExecutionContinuedAsNew event (same technique J1/E1 use to
 *      read history — `firstExecutionRunId` is what carries that event,
 *      not the current run's fresh post-reset history).
 *   3. Once found, decode that event's own recorded `input` — the actual
 *      arguments passed to continueAsNew() — via `defaultPayloadConverter`,
 *      the same technique A4 uses to decode a WorkflowExecutionStarted
 *      input. This is the check's PRIMARY, race-free evidence: it's
 *      whatever the workflow itself handed to continueAsNew(), read
 *      directly out of history, not inferred from timing-sensitive queries
 *      taken after the fact. If that carried input is identical to what the
 *      workflow was originally STARTED with, that's exactly the bug class
 *      E2 exists to catch — a continueAsNew() call that forgot to include
 *      the accumulated state and fell back to the original/default input,
 *      silently resetting progress back to the start.
 *   4. If a query is configured, corroborate with live state: a query taken
 *      right after the reset (auto-routed to the now-current run, since
 *      `handle.query()` targets the workflow ID with no fixed run ID) must
 *      differ from the pre-signal baseline — proving observable state
 *      genuinely changed and is still visible post-reset, not just that
 *      history recorded a change no live query can see.
 *   5. Keep sending the signal (still inside SIGNAL_BUDGET) until the
 *      workflow reaches a terminal COMPLETED state, confirming it has the
 *      natural stopping condition E2 needs (a workflow that only ever
 *      continues-as-new forever would never give this check — or a real
 *      operator — anything to wait on).
 *
 * This is deliberately narrower than "any project's Continue-As-New is
 * correct in general" — it only proves the ONE thing genuinely observable
 * from outside without business-logic knowledge: whatever state the
 * configured signal accumulates was still present, unmodified, on the far
 * side of the reset. The PASS message says this explicitly, same honesty
 * standard as B3/G1/L1.
 */
export const checkE2ContinueAsNewStatePreserved: DynamicFixtureCheckFn = async (env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (target.isLongRunning !== true) {
    return missingFixtureResult(base, "workflows[].isLongRunning");
  }

  if (isFixtureMissing(target.signals)) {
    return missingFixtureResult(base, "workflows[].signals");
  }
  const signal = target.signals![0];
  const queryName = !isFixtureMissing(target.queries) ? target.queries![0].name : null;

  const workflowId = generateWorkflowId("E2", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  try {
    return await withRunningWorker(env, target, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });
      const firstExecutionRunId = handle.firstExecutionRunId;
      const firstRunHandle = env.client.workflow.getHandle(workflowId, firstExecutionRunId);

      const baselineState = queryName
        ? await raceWithTimeout(handle.query(queryName), QUERY_WAIT_MS, () => {
            throw new Error(`query ${queryName} did not resolve within ${QUERY_WAIT_MS}ms`);
          })
        : null;

      let continuedAsNewEvent: proto.temporal.api.history.v1.IHistoryEvent | undefined;
      let sentCount = 0;

      for (sentCount = 1; sentCount <= SIGNAL_BUDGET; sentCount++) {
        await handle.signal(signal.name, signal.payload);
        const history = await firstRunHandle.fetchHistory();
        continuedAsNewEvent = (history.events ?? []).find(
          (e) => e.workflowExecutionContinuedAsNewEventAttributes != null,
        );
        if (continuedAsNewEvent) break;
        await new Promise((resolve) => setTimeout(resolve, DISCOVERY_POLL_INTERVAL_MS));
      }

      if (!continuedAsNewEvent) {
        return {
          ...base,
          status: "FAIL" as const,
          message:
            `Sent "${signal.name}" to ${target.type} ${SIGNAL_BUDGET} times, but no ` +
            "WorkflowExecutionContinuedAsNew event ever appeared in its first run's history — the workflow never " +
            "reset.",
          hint:
            `Either ${target.type} needs more than ${SIGNAL_BUDGET} deliveries of "${signal.name}" to reach its ` +
            "own continue-as-new threshold (this check's signal budget is a real, documented limit — see e2.ts), " +
            `or "${signal.name}" isn't wired to a real setHandler() that accumulates state toward a reset at all. ` +
            "Confirm the signal name matches, and that its handler is actually on the path to continueAsNew().",
        };
      }

      const carriedPayloads = continuedAsNewEvent.workflowExecutionContinuedAsNewEventAttributes?.input?.payloads ?? [];
      let carriedInput: unknown[];
      try {
        carriedInput = arrayFromPayloads(defaultPayloadConverter, carriedPayloads);
      } catch (e) {
        return {
          ...base,
          status: "FAIL" as const,
          message: `Could not decode the input ${target.type} carried into continueAsNew(): ${(e as Error).message}`,
          hint:
            "The WorkflowExecutionContinuedAsNew event's recorded input failed to decode through the default " +
            "payload converter — check for a custom or misconfigured data converter/codec.",
        };
      }

      if (JSON.stringify(carriedInput) === JSON.stringify(args)) {
        return {
          ...base,
          status: "FAIL" as const,
          message:
            `${target.type} called continueAsNew() with input identical to what it was ORIGINALLY started with ` +
            `(${JSON.stringify(carriedInput)}) — after ${sentCount} "${signal.name}" signal(s) had already been ` +
            "applied. This looks like the accumulated state was never included in the continueAsNew() call, so " +
            "the new run silently starts back over from scratch.",
          hint:
            `${target.type} must pass its own current, mutated state into continueAsNew() — not the workflow's ` +
            "original starting input and not a hardcoded default — or every reset silently discards whatever " +
            "had accumulated so far.",
        };
      }

      if (queryName) {
        const postResetState = await raceWithTimeout(handle.query(queryName), QUERY_WAIT_MS, () => {
          throw new Error(`query ${queryName} did not resolve within ${QUERY_WAIT_MS}ms`);
        });
        if (JSON.stringify(postResetState) === JSON.stringify(baselineState)) {
          return {
            ...base,
            status: "FAIL" as const,
            message:
              `${queryName} returned the same value after the reset (${JSON.stringify(postResetState)}) as it ` +
              `did before any "${signal.name}" signals were sent (${JSON.stringify(baselineState)}) — live ` +
              "queried state shows no sign of the accumulated changes surviving into the new run.",
            hint:
              `Confirm ${queryName}'s handler reads the same state field(s) that continueAsNew()'s carried input ` +
              "restores at the top of the next run.",
          };
        }
      }

      // The reset has already been confirmed above — this phase just needs
      // to drive the workflow to its own natural stopping condition.
      // Confirmed empirically (not just in theory) that sending the
      // remaining signal budget with NO delay between deliveries loses
      // signals around a continueAsNew boundary — the workflow can end up
      // stuck RUNNING, short of the total its own logic expects, with none
      // of the signal() calls themselves ever throwing to explain why. The
      // same DISCOVERY_POLL_INTERVAL_MS pacing used above avoids it. A
      // signal() call failing partway through (e.g. the workflow already
      // reached a terminal state after fewer signals than the full
      // remaining budget) just stops sending early — that's expected, not
      // an error worth surfacing.
      while (sentCount < SIGNAL_BUDGET) {
        try {
          await handle.signal(signal.name, signal.payload);
          sentCount++;
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, DISCOVERY_POLL_INTERVAL_MS));
      }

      let completed = false;
      let finalResult: unknown;
      let resultError: Error | undefined;
      const outcome = await raceWithTimeout<
        { done: true; result: unknown } | { done: true; error: Error } | { done: false }
      >(
        handle
          .result()
          .then((r) => ({ done: true as const, result: r }))
          .catch((e) => ({ done: true as const, error: e as Error })),
        RESULT_WAIT_MS,
        () => ({ done: false as const }),
      );
      if (outcome.done) {
        completed = true;
        if ("error" in outcome) {
          resultError = outcome.error;
        } else {
          finalResult = outcome.result;
        }
      }

      if (resultError) {
        return {
          ...base,
          status: "FAIL" as const,
          message: `${target.type} did not complete successfully after resetting via continue-as-new: ${resultError.message}`,
          hint:
            "A long-running workflow needs a real terminal state to reach after its resets — a workflow that " +
            "fails partway through a later cycle means whatever state was carried forward couldn't be processed " +
            "correctly, or a bug was introduced in a post-reset run specifically.",
        };
      }

      if (!completed) {
        return {
          ...base,
          status: "FAIL" as const,
          message:
            `${target.type} continued-as-new but never reached a terminal COMPLETED state within this check's ` +
            `signal/wait budget (${SIGNAL_BUDGET} total signals).`,
          hint:
            "This check needs the workflow to eventually complete so there's a real terminal state to confirm — " +
            "a workflow that only ever continues-as-new forever, or needs far more signals than this check " +
            "sends, gives no such stopping point to verify against.",
        };
      }

      return {
        ...base,
        status: "PASS" as const,
        message:
          `Confirmed ${target.type}'s accumulated state survives its own continue-as-new reset: after ` +
          `${sentCount} "${signal.name}" signal(s), a WorkflowExecutionContinuedAsNew event in the first run's ` +
          `history recorded continueAsNew() called with ${JSON.stringify(carriedInput)} — NOT the original ` +
          `starting input (${JSON.stringify(args)}) — proving accumulated state, not a fresh/default value, was ` +
          "carried forward." +
          (queryName
            ? ` A live query (${queryName}) taken right after the reset also differed from its pre-signal ` +
              "baseline, corroborating the same thing from outside history."
            : " No workflows[].queries entry was configured, so this check relies on event-history evidence " +
              "alone for that corroboration.") +
          ` The workflow went on to reach a terminal COMPLETED state with final result ${JSON.stringify(
            finalResult,
          )}. This confirms state survives THIS check's own signal-driven reset(s) — it does not prove every ` +
          `possible continue-as-new call site in ${target.type} carries state correctly, only the one this ` +
          `check's signal path actually exercised.`,
        hint: null,
      };
    });
  } catch (e) {
    return {
      ...base,
      status: "FAIL" as const,
      message: `Could not exercise ${target.type}'s continue-as-new reset: ${(e as Error).message}`,
      hint:
        `This check starts ${target.type}, sends workflows[].signals[0] repeatedly, and inspects its recorded ` +
        "event history. This failure is about setting that up (worker boot, workflow start, or a signal/query " +
        `call itself), not about state-preservation behavior — confirm workflows[].signals[0].name matches a ` +
        `real setHandler() registration in ${target.type}, and that workflows[].sampleInput is valid for it.`,
    };
  }
};
