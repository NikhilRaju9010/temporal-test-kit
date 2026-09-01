import { describe, expect, it } from "vitest";
import { runCheckWithGuards } from "./run-check.js";
import { TestResult } from "../../report/types.js";

const meta = {
  id: "X9",
  category: "Cat",
  name: "Some check",
  target: "SomeWorkflow",
  engine: "dynamic-zero-fixture" as const,
};

const passResult: TestResult = {
  id: "X9",
  category: "Cat",
  name: "Some check",
  status: "PASS",
  target: "SomeWorkflow",
  message: "all good",
  hint: null,
  engine: "dynamic-zero-fixture",
};

describe("runCheckWithGuards", () => {
  it("returns the check's own result unchanged when it succeeds", async () => {
    const result = await runCheckWithGuards(async () => passResult, meta, 5000);
    expect(result).toEqual(passResult);
  });

  it("passes through a legitimate FAIL result from the check unchanged", async () => {
    const failResult: TestResult = { ...passResult, status: "FAIL", message: "found a bug", hint: "fix the bug" };
    const result = await runCheckWithGuards(async () => failResult, meta, 5000);
    expect(result).toEqual(failResult);
  });

  it("converts an unhandled exception into ERRORED, distinct from FAIL", async () => {
    const result = await runCheckWithGuards(
      async () => {
        throw new Error("bug in the check itself");
      },
      meta,
      5000,
    );
    expect(result.status).toBe("ERRORED");
    expect(result.id).toBe("X9");
    expect(result.hint).toBeTruthy();
    expect(result.message).toContain("bug in the check itself");
  });

  it("converts a hang past the timeout into ERRORED instead of blocking forever", async () => {
    const result = await runCheckWithGuards(
      () => new Promise<TestResult>(() => {}), // never resolves
      meta,
      50,
    );
    expect(result.status).toBe("ERRORED");
    expect(result.hint).toBeTruthy();
    expect(result.message).toMatch(/timed out/i);
  });

  it("aborts the signal passed to fn when the check times out", async () => {
    let capturedSignal: AbortSignal | undefined;
    const result = await runCheckWithGuards(
      (signal) => {
        capturedSignal = signal;
        return new Promise<TestResult>(() => {}); // never resolves
      },
      meta,
      50,
    );
    expect(result.status).toBe("ERRORED");
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("does not abort the signal when the check succeeds within the timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    await runCheckWithGuards(
      async (signal) => {
        capturedSignal = signal;
        return passResult;
      },
      meta,
      5000,
    );
    expect(capturedSignal?.aborted).toBe(false);
  });
});
