import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkConfigValid,
  checkWorkerEntryPointExists,
  checkNodeVersion,
  checkRequiredPackagesInstalled,
} from "./checks.js";
import type { TestKitConfig } from "../../config/schema.js";

const validConfig: TestKitConfig = {
  project: "sample",
  workerEntryPoint: "./src/worker.ts",
  taskQueues: ["default"],
  workflows: [{ type: "GreetingWorkflow", taskQueue: "default" }],
};

describe("checkConfigValid", () => {
  it("passes for a valid config", () => {
    const result = checkConfigValid({ ok: true, config: validConfig });
    expect(result.passed).toBe(true);
  });

  it("fails with the load reason when config failed to load", () => {
    const result = checkConfigValid({ ok: false, reason: "Config file not found at x" });
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/not found/);
  });
});

describe("checkWorkerEntryPointExists", () => {
  it("passes when the entry point file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttk-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "worker.ts"), "// worker");
    const result = checkWorkerEntryPointExists(dir, "./src/worker.ts");
    expect(result.passed).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when the entry point file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttk-"));
    const result = checkWorkerEntryPointExists(dir, "./src/worker.ts");
    expect(result.passed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("checkNodeVersion", () => {
  it("passes when running node version meets the minimum", () => {
    const result = checkNodeVersion("v22.23.1", 18);
    expect(result.passed).toBe(true);
  });

  it("fails when running node version is below the minimum", () => {
    const result = checkNodeVersion("v16.20.0", 18);
    expect(result.passed).toBe(false);
  });
});

describe("checkRequiredPackagesInstalled", () => {
  it("passes when all required @temporalio packages are present in node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttk-"));
    mkdirSync(join(dir, "node_modules", "@temporalio", "worker"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "@temporalio", "workflow"), { recursive: true });
    const result = checkRequiredPackagesInstalled(dir, ["@temporalio/worker", "@temporalio/workflow"]);
    expect(result.passed).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails and names the missing package", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttk-"));
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    const result = checkRequiredPackagesInstalled(dir, ["@temporalio/worker"]);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("@temporalio/worker");
    rmSync(dir, { recursive: true, force: true });
  });
});
