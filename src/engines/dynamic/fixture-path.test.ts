import { describe, expect, it } from "vitest";
import { fixturePath } from "./fixture-path.js";

describe("fixturePath", () => {
  it("uses .ts when the calling module's own URL ends in .ts (source/tsx dev mode)", () => {
    const result = fixturePath("file:///repo/src/engines/dynamic/checks/d1.ts", "/repo/src/engines/dynamic/checks", "d1-timer-workflow");
    expect(result).toBe("/repo/src/engines/dynamic/checks/fixtures/d1-timer-workflow.ts");
  });

  it("uses .js when the calling module's own URL ends in .js (compiled dist/ mode)", () => {
    const result = fixturePath("file:///repo/dist/engines/dynamic/checks/d1.js", "/repo/dist/engines/dynamic/checks", "d1-timer-workflow");
    expect(result).toBe("/repo/dist/engines/dynamic/checks/fixtures/d1-timer-workflow.js");
  });
});
