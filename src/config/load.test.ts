import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./load.js";

describe("loadConfig", () => {
  it("returns ok:false when the file doesn't exist", () => {
    const result = loadConfig("/nonexistent/temporal-test-kit.config.json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not found/i);
    }
  });

  it("returns ok:false with a parse error on invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttk-"));
    const file = join(dir, "temporal-test-kit.config.json");
    writeFileSync(file, "{ not valid json");

    const result = loadConfig(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/invalid json/i);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns ok:true with the parsed config for a valid file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttk-"));
    const file = join(dir, "temporal-test-kit.config.json");
    writeFileSync(
      file,
      JSON.stringify({
        project: "sample",
        workerEntryPoint: "./src/worker.ts",
        taskQueues: ["default"],
        workflows: [{ type: "GreetingWorkflow", taskQueue: "default" }],
      }),
    );

    const result = loadConfig(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.project).toBe("sample");
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
