import { existsSync } from "node:fs";
import { join } from "node:path";
import { LoadConfigResult } from "../../config/load.js";
import { PreflightResult } from "../../report/types.js";

export function checkConfigValid(loadResult: LoadConfigResult): PreflightResult {
  if (loadResult.ok) {
    return { name: "config valid", passed: true, message: "temporal-test-kit.config.json is present and valid" };
  }
  return { name: "config valid", passed: false, message: loadResult.reason };
}

export function checkWorkerEntryPointExists(projectRoot: string, workerEntryPoint: string): PreflightResult {
  const fullPath = join(projectRoot, workerEntryPoint);
  const exists = existsSync(fullPath);
  return {
    name: "worker entry point exists",
    passed: exists,
    message: exists
      ? `Found worker entry point at ${fullPath}`
      : `workerEntryPoint not found at ${fullPath}`,
  };
}

export function checkNodeVersion(actualVersion: string, minimumMajor: number): PreflightResult {
  const major = Number(actualVersion.replace(/^v/, "").split(".")[0]);
  const passed = major >= minimumMajor;
  return {
    name: "node version",
    passed,
    message: passed
      ? `Node ${actualVersion} meets the minimum (>=${minimumMajor})`
      : `Node ${actualVersion} is below the minimum required (>=${minimumMajor})`,
  };
}

export function checkRequiredPackagesInstalled(projectRoot: string, requiredPackages: string[]): PreflightResult {
  const missing = requiredPackages.filter(
    (pkg) => !existsSync(join(projectRoot, "node_modules", pkg)),
  );
  return {
    name: "required packages installed",
    passed: missing.length === 0,
    message:
      missing.length === 0
        ? "All required @temporalio packages are installed"
        : `Missing packages in node_modules: ${missing.join(", ")}`,
  };
}
