import { arrayFromPayloads, defaultPayloadConverter } from "@temporalio/common";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "A4")!;

// Bounded internal wait, kept well under the orchestrator's 15s per-check
// ceiling (see CLAUDE.md's "Per-check timeout and error isolation") so this
// check has room left to fetch history and grade before runCheckWithGuards
// would time it out and report ERRORED instead of our own PASS/FAIL. The
// WorkflowExecutionStarted event this check actually grades is written to
// history synchronously at start — this wait just avoids leaving a pile of
// still-running workflows behind against the ephemeral server.
const WAIT_TIMEOUT_MS = 5_000;

/**
 * A deliberately complex, nested probe payload: an object, an array, a
 * boolean, an explicit null, a decimal number, and a unicode string, all in
 * one value. This is zero-fixture — there's no known-good sample input for
 * `target.workflowType`'s business logic, so this check can't assert
 * anything about what the workflow *does* with the payload. What it can
 * assert, without any business knowledge, is whether Temporal's data
 * converter faithfully records this exact structure in the workflow's own
 * event history, independent of whatever the workflow's code does with it.
 */
export const PROBE_PAYLOAD = {
  __ttkProbe: true,
  count: 42.5,
  flag: true,
  nothing: null,
  tags: ["a", "b", "c"],
  nested: { deep: { value: "héllo" } },
};

export async function checkA4DataIntegrity(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.workflowType,
    engine: "dynamic-zero-fixture" as const,
  };

  const workflowId = generateWorkflowId("A4", target.workflowType);

  return withRunningWorker(env, target, async () => {
    const handle = await env.client.workflow.start(target.workflowType, {
      taskQueue: target.taskQueue,
      workflowId,
      args: [PROBE_PAYLOAD],
    });

    // Not strictly necessary — WorkflowExecutionStarted is written at start
    // — but bounded so this check doesn't leave the workflow running against
    // the ephemeral server any longer than it has to.
    await raceWithTimeout(handle.result().catch(() => {}), WAIT_TIMEOUT_MS, () => undefined);

    const history = await handle.fetchHistory();
    const startedEvent = history.events?.find((e) => e.workflowExecutionStartedEventAttributes != null);

    if (!startedEvent?.workflowExecutionStartedEventAttributes) {
      return {
        ...base,
        status: "FAIL",
        message: `Could not find a WorkflowExecutionStarted event in ${target.workflowType}'s recorded history.`,
        hint:
          "Every workflow execution's history must start with a WorkflowExecutionStarted event recording its " +
          "input. Its absence here points at a problem with history recording or retrieval itself, not the " +
          "target workflow's business logic — worth investigating before trusting any other history-based check.",
      };
    }

    const inputPayloads = startedEvent.workflowExecutionStartedEventAttributes.input?.payloads ?? [];

    let decoded: unknown[];
    try {
      decoded = arrayFromPayloads(defaultPayloadConverter, inputPayloads);
    } catch (e) {
      return {
        ...base,
        status: "FAIL",
        message: `Decoding ${target.workflowType}'s recorded input payload threw: ${(e as Error).message}`,
        hint:
          "Data corruption or loss between a workflow's start call and its recorded event history is a serious " +
          "correctness bug — it would affect EVERY workflow's input, not just this test. Check for a custom or " +
          "misconfigured data converter/codec on the client or worker.",
      };
    }

    const decodedInput = decoded[0];
    const roundTripped = deepEqual(decodedInput, PROBE_PAYLOAD);

    if (roundTripped) {
      return {
        ...base,
        status: "PASS",
        message:
          `${target.workflowType}'s complex probe payload round-tripped through the data converter and into ` +
          `its recorded event history without loss or corruption.`,
        hint: null,
      };
    }

    return {
      ...base,
      status: "FAIL",
      message:
        `${target.workflowType}'s recorded WorkflowExecutionStarted input does not match the probe payload it ` +
        `was started with. Decoded: ${safeStringify(decodedInput)}`,
      hint:
        "Data corruption or loss between a workflow's start call and its recorded event history is a serious " +
        "correctness bug — it would corrupt EVERY workflow's input, not just this test. Check for a custom or " +
        "misconfigured data converter/codec on the client or worker.",
    };
  }, signal);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(bObj, k) && deepEqual(aObj[k], bObj[k]));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
