import { dirname, join } from "node:path";
import { LoadConfigResult } from "../../config/load.js";
import { PreflightReport } from "../../report/types.js";
import {
  checkConfigValid,
  checkWorkerEntryPointExists,
  checkNodeVersion,
  checkRequiredPackagesInstalled,
} from "./checks.js";
import { checkPortAvailable } from "./port.js";
import { bootWorker, EphemeralEnvironment } from "../dynamic/environment.js";

const REQUIRED_PACKAGES = ["@temporalio/worker", "@temporalio/workflow", "@temporalio/testing"];
const MINIMUM_NODE_MAJOR = 18;

export interface RunPreflightOptions {
  projectRoot: string;
  configResult: LoadConfigResult;
  nodeVersion: string;
  port: number;
  env: EphemeralEnvironment;
}

export async function runPreflight(options: RunPreflightOptions): Promise<PreflightReport> {
  const results = [
    checkConfigValid(options.configResult),
    checkNodeVersion(options.nodeVersion, MINIMUM_NODE_MAJOR),
  ];

  if (!options.configResult.ok) {
    return { passed: false, results, fatalMessage: null };
  }
  const config = options.configResult.config;

  results.push(checkWorkerEntryPointExists(options.projectRoot, config.workerEntryPoint));
  results.push(checkRequiredPackagesInstalled(options.projectRoot, REQUIRED_PACKAGES));
  results.push(await checkPortAvailable(options.port));

  if (results.some((r) => !r.passed)) {
    return { passed: false, results, fatalMessage: null };
  }

  const workerDir = dirname(join(options.projectRoot, config.workerEntryPoint));
  const workflowsPath = join(workerDir, "workflows.ts");
  let activities: Record<string, unknown>;
  try {
    activities = await import(join(workerDir, "activities.ts"));
  } catch (e) {
    return {
      passed: false,
      results,
      fatalMessage: `Failed to load activities module: ${(e as Error).message}`,
    };
  }

  const bootResult = await bootWorker(options.env, {
    workflowsPath,
    activities,
    taskQueue: config.taskQueues[0] ?? "default",
  });

  if (!bootResult.booted) {
    return {
      passed: false,
      results,
      fatalMessage: `Worker failed to start: ${bootResult.error}`,
    };
  }

  results.push({ name: "worker boot sanity check", passed: true, message: "Worker registered successfully" });
  return { passed: true, results, fatalMessage: null };
}
