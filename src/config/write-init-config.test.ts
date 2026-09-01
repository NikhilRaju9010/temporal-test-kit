import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeInitConfig } from "./write-init-config.js";
import { loadConfig } from "./load.js";

describe("writeInitConfig", () => {
  it("writes a starter config file when none exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttk-init-"));
    const configPath = join(dir, "temporal-test-kit.config.json");

    const result = writeInitConfig(dir);

    expect(result.ok).toBe(true);
    expect(readFileSync(configPath, "utf-8")).toContain('"project"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to overwrite an existing config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttk-init-"));
    const configPath = join(dir, "temporal-test-kit.config.json");
    writeFileSync(configPath, '{"project":"already-here","workerEntryPoint":"x","taskQueues":[],"workflows":[]}');

    const result = writeInitConfig(dir);

    expect(result.ok).toBe(false);
    // Must not have clobbered the existing file's real content.
    expect(readFileSync(configPath, "utf-8")).toContain("already-here");
    rmSync(dir, { recursive: true, force: true });
  });

  it("the file it writes actually loads successfully via loadConfig (real end-to-end, not just valid-in-isolation)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttk-init-"));
    const configPath = join(dir, "temporal-test-kit.config.json");

    writeInitConfig(dir);
    const loaded = loadConfig(configPath);

    expect(loaded.ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
