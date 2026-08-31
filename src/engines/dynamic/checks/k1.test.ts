import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { defaultPayloadConverter } from "@temporalio/common";
import { withEphemeralEnvironment } from "../environment.js";
import {
  BINARY_PROBE,
  STRUCTURAL_PROBE,
  checkK1DataConverterRoundTrip,
  roundTripBinary,
  roundTripValue,
} from "./k1.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("roundTripValue (unit, real @temporalio/common default converter, no mocking)", () => {
  it("round-trips the structural probe (nested objects/arrays, null, bool, float, non-ASCII string) losslessly", () => {
    const result = roundTripValue(defaultPayloadConverter, STRUCTURAL_PROBE);
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.decoded).toEqual(STRUCTURAL_PROBE);
  });

  it("reports a mismatch (not ok) when the converter given corrupts the value", () => {
    const corruptingConverter = {
      toPayload: defaultPayloadConverter.toPayload.bind(defaultPayloadConverter),
      fromPayload: <T,>(): T => ({ corrupted: true }) as T,
    };
    const result = roundTripValue(corruptingConverter, STRUCTURAL_PROBE);
    expect(result.ok).toBe(false);
    expect(result.error).toBeNull();
  });

  it("captures the thrown error (not ok) when the converter throws during encode/decode", () => {
    const throwingConverter = {
      toPayload: (): never => {
        throw new Error("boom");
      },
      fromPayload: (): never => {
        throw new Error("unreachable");
      },
    };
    const result = roundTripValue(throwingConverter, STRUCTURAL_PROBE);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});

describe("roundTripBinary (unit, real @temporalio/common default converter, no mocking)", () => {
  it("round-trips a top-level Uint8Array byte-for-byte via the default converter's dedicated binary encoding", () => {
    const result = roundTripBinary(defaultPayloadConverter, BINARY_PROBE);
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
  });

  it("detects corrupted bytes coming back from a broken converter", () => {
    const corruptingConverter = {
      toPayload: defaultPayloadConverter.toPayload.bind(defaultPayloadConverter),
      fromPayload: <T,>(): T => new Uint8Array([9, 9, 9]) as unknown as T,
    };
    const result = roundTripBinary(corruptingConverter, BINARY_PROBE);
    expect(result.ok).toBe(false);
    expect(result.error).toBeNull();
  });

  it("detects a converter that returns the wrong type entirely (not a Uint8Array)", () => {
    const corruptingConverter = {
      toPayload: defaultPayloadConverter.toPayload.bind(defaultPayloadConverter),
      fromPayload: <T,>(): T => ({ 0: 0, 1: 1, 2: 2 }) as unknown as T,
    };
    const result = roundTripBinary(corruptingConverter, BINARY_PROBE);
    expect(result.ok).toBe(false);
  });
});

describe("checkK1DataConverterRoundTrip (real @temporalio/testing + sample project, no mocking)", () => {
  it("passes when the project's live client is wired to the standard, lossless default data converter", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkK1DataConverterRoundTrip(env, {
        workflowType: "GreetingWorkflow",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("K1");
    expect(result.category).toBe("Data & Security");
    expect(result.hint).toBeNull();
    // Not scoped to any one workflow — this is a project-wide converter
    // check, not a per-workflow one. See k1.ts's module doc comment.
    expect(result.target).toBe("data converter (project-wide)");
  }, 30_000);

  it("never depends on the target workflow actually succeeding — an unknown/garbage workflow type still grades the converter", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkK1DataConverterRoundTrip(env, {
        workflowType: "ThisWorkflowTypeDoesNotExist",
        taskQueue: "default",
        workflowsPath: WORKFLOWS_PATH,
        activities,
      }),
    );

    // The converter round-trip is a pure function of env.client's configured
    // converter; it never starts/awaits `target.workflowType` at all, so a
    // bogus workflow type has no effect on the result.
    expect(result.status).toBe("PASS");
    expect(result.id).toBe("K1");
  }, 30_000);
});
