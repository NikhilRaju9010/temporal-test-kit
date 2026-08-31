import { EphemeralEnvironment, WorkerTarget } from "./environment.js";
import { WorkflowConfig, FeaturesConfig } from "../../config/schema.js";
import { TestResult } from "../../report/types.js";

/**
 * What a dynamic-fixture check function receives: the same `WorkerTarget`
 * shape zero-fixture checks get (workflowsPath/activities/taskQueue) merged
 * with that workflow's FULL config entry (sampleInput, signals, updates,
 * sagaFailurePoint, etc. — everything Appendix A adds), plus the project's
 * `features` flags for checks that need project-wide values
 * (`scheduleWorkflowId`, `customSearchAttributeKeys`) rather than a
 * per-workflow one. `config.workflows[]`'s own `type`/`taskQueue` already
 * satisfy `WorkerTarget`'s shape, so this is a plain merge, not a mapping.
 */
export type DynamicFixtureTarget = WorkerTarget & WorkflowConfig;

export type DynamicFixtureCheckFn = (
  env: EphemeralEnvironment,
  target: DynamicFixtureTarget,
  features: FeaturesConfig,
) => Promise<TestResult>;
