import { isDeepStrictEqual } from "node:util";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget } from "../environment.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "K1")!;

/**
 * K1 vs A4 — how these two similar-sounding checks stay distinct:
 *
 * A4 ("dynamic-zero-fixture", checks/a4.ts) starts a real workflow with a
 * probe payload and asserts that the exact same value comes back out of the
 * *recorded event history* (WorkflowExecutionStarted) — i.e. it tests the
 * full client -> server -> history pipeline for one specific value on one
 * specific execution, hardcoded against `defaultPayloadConverter`.
 *
 * K1 (this file) tests the *data converter itself*, standalone, as a unit —
 * the "needs a dev to run a code-level check on the data converter, not
 * manually testable via Web UI" checklist item. It never starts a workflow
 * and never depends on `target.workflowType`'s business logic succeeding,
 * failing, or even existing. Instead it pulls whatever converter is actually
 * configured on this project's live client (`env.client.options
 * .loadedDataConverter.payloadConverter` — the same object used for every
 * real workflow/activity/signal start through this client, including
 * `target.workflowType`) and round-trips probe values through its
 * `toPayload`/`fromPayload` API directly. If this project ever swaps in a
 * custom/buggy data converter (see `features.customDataConverter`), K1
 * catches it here; A4 would only catch it indirectly, and only for values
 * it happens to send through a running workflow.
 */

/**
 * Covers the JS value shapes that most commonly trip up a naive or buggy
 * data converter: nested objects/arrays, `null`, booleans, a non-integer
 * float, and a string with non-ASCII/multi-byte characters.
 *
 * Deliberately does NOT include a `Uint8Array` nested inside this object.
 * Verified by hand against `@temporalio/common`'s `defaultPayloadConverter`
 * before writing this check: its `CompositePayloadConverter` only tries the
 * dedicated binary encoding (`BinaryPayloadConverter`) against a *top-level*
 * `Uint8Array` value. A `Uint8Array` nested inside a plain object falls
 * through to the JSON converter, which `JSON.stringify`s it into a plain
 * `{"0":0,"1":1,...}` object — losing its `Uint8Array`-ness. That's an
 * inherent, well-understood property of JSON-based encoding, not "data
 * converter corruption" in the sense K1 is looking for: every project using
 * the SDK's stock default converter would otherwise fail K1 for a reason
 * that has nothing to do with a real bug. So binary is round-tripped
 * separately, below, as its own top-level probe — the shape the converter
 * actually promises to handle losslessly.
 */
export const STRUCTURAL_PROBE = {
  str: "héllo wörld 🎉",
  num: 3.14159,
  bool: false,
  nothing: null,
  arr: [1, "two", 3.0, null],
  nested: { a: { b: { c: [true, false] } } },
};

/** Top-level binary probe — see STRUCTURAL_PROBE's doc comment for why it's separate. */
export const BINARY_PROBE = new Uint8Array([0, 1, 2, 255, 128, 7]);

/**
 * The minimal surface this check needs from a data converter. Matches
 * `@temporalio/common`'s `PayloadConverter` interface structurally, without
 * importing it, so tests can pass in a deliberately broken fake without
 * needing to implement the whole real interface.
 */
export interface DataConverterLike {
  toPayload<T>(value: T): unknown;
  fromPayload<T>(payload: unknown): T;
}

export interface RoundTripResult<T> {
  ok: boolean;
  decoded: T | undefined;
  error: string | null;
}

/** Encodes `value` then decodes it back through `converter`, deep-comparing the result against the original. */
export function roundTripValue<T>(converter: DataConverterLike, value: T): RoundTripResult<T> {
  try {
    const payload = converter.toPayload(value);
    const decoded = converter.fromPayload<T>(payload);
    return { ok: isDeepStrictEqual(decoded, value), decoded, error: null };
  } catch (e) {
    return { ok: false, decoded: undefined, error: (e as Error).message };
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface BinaryRoundTripResult {
  ok: boolean;
  error: string | null;
}

/** Encodes/decodes a raw `Uint8Array` through `converter`, comparing bytes (never `===`, which would fail for any distinct instance). */
export function roundTripBinary(converter: DataConverterLike, value: Uint8Array): BinaryRoundTripResult {
  try {
    const payload = converter.toPayload(value);
    const decoded = converter.fromPayload<unknown>(payload);
    const ok = decoded instanceof Uint8Array && bytesEqual(decoded, value);
    return { ok, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function checkK1DataConverterRoundTrip(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    // Not scoped to any one workflow — this checks the converter itself,
    // the same converter object every workflow/activity/signal payload in
    // this project passes through. See this file's module doc comment for
    // why K1 deliberately never starts `target.workflowType`.
    target: "data converter (project-wide)",
    engine: "dynamic-zero-fixture" as const,
  };

  // The converter actually wired into this project's live client — the same
  // one used to start target.workflowType and every other workflow. Reading
  // it off env.client (rather than importing @temporalio/common's
  // defaultPayloadConverter directly) is what lets K1 catch a project that
  // has swapped in a custom/misconfigured converter, not just test the SDK.
  const converter = env.client.options.loadedDataConverter.payloadConverter;

  const structural = roundTripValue(converter, STRUCTURAL_PROBE);
  const binary = roundTripBinary(converter, BINARY_PROBE);

  if (structural.ok && binary.ok) {
    return {
      ...base,
      status: "PASS",
      message:
        `The data converter configured for this project's client (used to start ${target.workflowType} and every ` +
        "other workflow, activity, and signal) round-trips complex nested objects, arrays, null, booleans, " +
        "floating point numbers, non-ASCII strings, and raw binary data without loss.",
      hint: null,
    };
  }

  const problems: string[] = [];
  if (!structural.ok) {
    problems.push(
      structural.error
        ? `encoding/decoding a structural probe value threw: ${structural.error}`
        : `the decoded structural probe does not match the original value (got ${safeStringify(structural.decoded)})`,
    );
  }
  if (!binary.ok) {
    problems.push(
      binary.error
        ? `encoding/decoding a raw Uint8Array threw: ${binary.error}`
        : "a raw Uint8Array came back corrupted (wrong bytes, or not a Uint8Array at all) after round-tripping",
    );
  }

  return {
    ...base,
    status: "FAIL",
    message: `Data converter round-trip failed: ${problems.join("; ")}.`,
    hint:
      "A data converter that silently corrupts values on the way in or out would corrupt EVERY payload passed " +
      "through this project's workflows, activities, and signals — a serious, wide-reaching bug, not a one-off. " +
      "If this project sets features.customDataConverter, check that custom converter's toPayload/fromPayload " +
      "implementation first (encoding bugs, lossy compression/encryption, wrong encoding metadata); if it's using " +
      "the SDK's stock default converter, this points at an SDK-level regression worth reporting upstream.",
  };
}
