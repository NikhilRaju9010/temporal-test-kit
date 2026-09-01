import proto from "@temporalio/proto";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "K2")!;
const EventType = proto.temporal.api.enums.v1.EventType;

// Bounded wait for the workflow to reach a terminal state, same shape as
// g1.ts/e2.ts's own bounded waits — kept comfortably under the
// orchestrator's 15s per-check ceiling (CLAUDE.md's "Per-check timeout and
// error isolation"). K2 doesn't strictly need the workflow to FINISH — the
// sensitive value is written into WorkflowExecutionStarted history
// synchronously at start — this just avoids leaving a pile of still-running
// workflows behind and lets any activities that echo the value back
// (result/failure payloads) get a chance to record it too.
const RESULT_WAIT_MS = 10_000;

/**
 * Recursively searches `input` for an own property named `fieldName`,
 * anywhere in the object/array tree, and returns its value stringified for
 * literal-text search. `workflows[].sensitiveDataFields` is a list of FIELD
 * NAMES (e.g. `"cardNumber"`) — the actual sensitive VALUE lives in
 * `workflows[].sampleInput` under that name. sample-project's own
 * `sampleInput` is flat, but this doesn't assume every project's is, so it
 * walks the whole tree rather than only checking top-level keys.
 *
 * Returns `undefined` if `fieldName` isn't found anywhere in `input` — a
 * real, honest outcome (a config/fixture mismatch between
 * `sensitiveDataFields` and `sampleInput`, not a "no leak found" result),
 * left for the caller to report distinctly rather than silently treating as
 * a clean pass.
 */
export function extractFieldValue(input: unknown, fieldName: string, depth = 0): string | undefined {
  if (input === null || input === undefined || depth > 20) return undefined;
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = extractFieldValue(item, fieldName, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(obj, fieldName)) {
      const value = obj[fieldName];
      if (value === null || value === undefined) return undefined;
      return typeof value === "string" ? value : JSON.stringify(value);
    }
    for (const key of Object.keys(obj)) {
      const found = extractFieldValue(obj[key], fieldName, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Recursively collects every string this raw history-event value contains,
 * INCLUDING decoded Payload bytes. `fetchHistory()` returns proto objects
 * where a `Payload`'s `data` field is a raw `Buffer`/`Uint8Array` (confirmed
 * empirically — logged an actual fetched history's `IPayload` shape:
 * `{ metadata: { encoding: <Buffer 'json/plain'> }, data: <Buffer ...json bytes...> }`),
 * not a pre-decoded value and not a base64 string — so this walks the whole
 * tree and utf8-decodes any byte buffer it finds, rather than trying to
 * locate and decode `Payload` nodes specifically via the data converter (the
 * technique `checkK1DataConverterRoundTrip`/A4 use when they already know
 * exactly which single payload they're decoding). K2 doesn't know in
 * advance which of history's many payloads (workflow input, activity
 * input/output, signal input, failure details, memos, search attributes...)
 * might carry the sensitive value, so it searches all of them generically —
 * decode-everything-to-text is the right tool for "does this literal value
 * appear ANYWHERE," not for asserting one specific value round-trips.
 */
export function collectSearchableStrings(value: unknown, acc: string[] = [], depth = 0): string[] {
  if (value === null || value === undefined || depth > 40) return acc;
  if (Buffer.isBuffer(value)) {
    try {
      acc.push(value.toString("utf8"));
    } catch {
      // Not decodable as utf8 (genuinely binary data) — nothing to search here.
    }
    return acc;
  }
  if (value instanceof Uint8Array) {
    try {
      acc.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8"));
    } catch {
      // Not decodable as utf8 — skip.
    }
    return acc;
  }
  if (typeof value === "string") {
    acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchableStrings(item, acc, depth + 1);
    return acc;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      collectSearchableStrings((value as Record<string, unknown>)[key], acc, depth + 1);
    }
  }
  return acc;
}

// Reverse lookup from EventType's numeric value back to its readable name
// (e.g. "EVENT_TYPE_WORKFLOW_EXECUTION_STARTED"), for naming which event a
// match showed up in. Built generically from the whole enum rather than
// hand-listing every member (unlike e.g. j1.ts's TERMINAL_EVENT_NAMES,
// which only needs a handful of terminal types) since a leak could
// plausibly show up in almost any event type.
const EVENT_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(EventType)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => [v as number, k]),
);

/** Best-effort human label for which event a match was found in — "if you can identify it," per this check's own honesty bar. Names the scheduled activity's type too, when the event is an ActivityTaskScheduled. */
function describeEvent(event: proto.temporal.api.history.v1.IHistoryEvent): string {
  const name = EVENT_TYPE_NAMES[event.eventType as number] ?? `eventType=${event.eventType}`;
  const activityName = event.activityTaskScheduledEventAttributes?.activityType?.name;
  return activityName ? `${name} (${activityName})` : name;
}

interface FieldSearch {
  field: string;
  value: string | undefined;
}

/**
 * K2 forces `target.type` to actually run with the real sensitive value in
 * `workflows[].sampleInput`, fetches its full recorded event history, and
 * checks whether each `workflows[].sensitiveDataFields` value shows up
 * anywhere in that history in PLAIN TEXT (i.e. decodable straight to a
 * readable string with nothing more than utf8 decoding — no decryption, no
 * secret key). It never asserts anything about logs, external systems, or
 * secondary storage this tool has no visibility into — only Temporal's own
 * event history, as recorded by whatever data converter this project's
 * client is actually configured with.
 */
export const checkK2SensitiveDataNotExposed: DynamicFixtureCheckFn = async (env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.sensitiveDataFields)) {
    return missingFixtureResult(base, "workflows[].sensitiveDataFields");
  }
  const fields = target.sensitiveDataFields as string[];

  const searches: FieldSearch[] = fields.map((field) => ({
    field,
    value: extractFieldValue(target.sampleInput, field),
  }));
  const checkable = searches.filter((s): s is FieldSearch & { value: string } => s.value !== undefined);
  const unresolved = searches.filter((s) => s.value === undefined);

  const workflowId = generateWorkflowId("K2", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  let events: proto.temporal.api.history.v1.IHistoryEvent[];
  try {
    events = await withRunningWorker(env, target, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });
      await raceWithTimeout(
        handle.result().catch(() => undefined),
        RESULT_WAIT_MS,
        () => undefined,
      );
      const history = await handle.fetchHistory();
      return history.events ?? [];
    });
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not run ${target.type} with workflows[].sampleInput to record an event history: ${(e as Error).message}`,
      hint:
        `This check needs to start ${target.type} with workflows[].sampleInput and fetch its recorded event ` +
        "history. This failure is about setting that up, not about sensitive-data exposure — confirm " +
        "workflows[].sampleInput is valid input for this workflow, and that the worker boots against " +
        `${target.taskQueue}.`,
    };
  }

  const unresolvedNote =
    unresolved.length > 0
      ? ` ${unresolved.map((s) => `"${s.field}"`).join(", ")} could not be found anywhere in workflows[].sampleInput ` +
        "(as a top-level or nested field name), so this run has no actual value to search history for — " +
        (checkable.length > 0
          ? "not counted toward the result below, checked or otherwise."
          : "and none of the configured sensitiveDataFields resolved to a real value, so this run verified " +
            "nothing at all.")
      : "";

  if (checkable.length === 0) {
    return {
      ...base,
      status: "PASS",
      message:
        `None of workflows[].sensitiveDataFields (${fields.map((f) => `"${f}"`).join(", ")}) resolved to an ` +
        `actual value in workflows[].sampleInput for ${target.type}, so there was no literal value to search ` +
        "this run's event history for." +
        unresolvedNote +
        " Reported as PASS narrowly and honestly: nothing was actually checked, so this proves nothing about " +
        "whether real sensitive data would leak. Fix workflows[].sampleInput to actually include a value under " +
        "each sensitiveDataFields name to get a meaningful result.",
      hint: null,
    };
  }

  const matches: { field: string; eventLabel: string }[] = [];
  for (const event of events) {
    const text = collectSearchableStrings(event).join("\n");
    for (const { field, value } of checkable) {
      if (text.includes(value)) {
        matches.push({ field, eventLabel: describeEvent(event) });
      }
    }
  }

  if (matches.length > 0) {
    const uniqueMatchDescriptions = [...new Set(matches.map((m) => `"${m.field}" in ${m.eventLabel}`))];
    return {
      ...base,
      status: "FAIL",
      message:
        `${target.type}'s recorded event history exposes ${checkable.length === 1 ? "a sensitive field" : "sensitive field(s)"} ` +
        `in plain text: ${uniqueMatchDescriptions.join("; ")}.` +
        unresolvedNote,
      hint:
        "Temporal's event history is durable, long-retained storage that anyone with Web UI/CLI/API access to " +
        "this namespace can read — sensitive values (payment details, credentials, PII) recorded there in plain " +
        "text are exposed to that whole audience, not just this project's own application code. Configure a " +
        "custom/redacting data converter or payload codec (e.g. encrypting sensitive fields, or excluding them " +
        "from what gets passed to Temporal at all) so this value isn't written to history in a form anyone with " +
        "read access can recover.",
    };
  }

  return {
    ...base,
    status: "PASS",
    message:
      `Searched ${target.type}'s full recorded event history (decoding every payload found, including workflow ` +
      `input/result and activity input/result/failure payloads) and did not find ${checkable.map((s) => `"${s.field}"`).join(", ")} ` +
      "in plain text anywhere." +
      unresolvedNote +
      " This only proves the value didn't appear in plain text in the DEFAULT data converter's recorded output " +
      "for THIS run — it does NOT prove there's no other leak vector (application logs, external systems, " +
      "secondary storage) outside what Temporal's own event history records.",
    hint: null,
  };
};
