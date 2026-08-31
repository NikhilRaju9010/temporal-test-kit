import { describe, expect, it } from "vitest";
import { checkA2NoUnsafeCode, checkB1Timeouts, checkB2RetryPolicy } from "./checks.js";

describe("checkA2NoUnsafeCode (no Date.now()/Math.random() in workflow code)", () => {
  it("passes when workflow source has no unsafe calls", () => {
    const result = checkA2NoUnsafeCode("export async function W() { return proxyActivities(); }");
    expect(result.status).toBe("PASS");
  });

  it("fails and names the violation when Date.now() is used", () => {
    const result = checkA2NoUnsafeCode("export async function W() { const t = Date.now(); return t; }");
    expect(result.status).toBe("FAIL");
    expect(result.hint).toBeTruthy();
  });

  it("fails when Math.random() is used", () => {
    const result = checkA2NoUnsafeCode("const x = Math.random();");
    expect(result.status).toBe("FAIL");
  });
});

describe("checkB1Timeouts (every proxyActivities call sets a timeout)", () => {
  it("passes when startToCloseTimeout is set", () => {
    const result = checkB1Timeouts(`proxyActivities({ startToCloseTimeout: "10 seconds" });`);
    expect(result.status).toBe("PASS");
  });

  it("fails when proxyActivities is called with no timeout field", () => {
    const result = checkB1Timeouts(`proxyActivities({ retry: { maximumAttempts: 3 } });`);
    expect(result.status).toBe("FAIL");
    expect(result.hint).toBeTruthy();
  });
});

describe("checkB2RetryPolicy (retry policy present and not absurd)", () => {
  it("passes when a retry policy with a bounded maximumAttempts is set", () => {
    const result = checkB2RetryPolicy(
      `proxyActivities({ startToCloseTimeout: "10s", retry: { maximumAttempts: 5 } });`,
    );
    expect(result.status).toBe("PASS");
  });

  it("fails when no retry policy is configured at all", () => {
    const result = checkB2RetryPolicy(`proxyActivities({ startToCloseTimeout: "10s" });`);
    expect(result.status).toBe("FAIL");
  });
});
