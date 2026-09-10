/**
 * Full config schema, per the build spec's Appendix A. Every field beyond
 * `type`/`taskQueue` (and `project`/`workerEntryPoint`/`taskQueues` at the
 * top level) is OPTIONAL by design — a blank fixture field just means the
 * test(s) it unlocks report SKIPPED, never a validation error (spec Section
 * 4.1). Validation here only checks TYPE SHAPE (is it an array, does an
 * entry have the required sub-fields) — it deliberately does not validate
 * the CONTENTS of free-form fields like `sampleInput`/`payload`/
 * `validInput`/`invalidInput` (arbitrary JSON, checked only by JSON.parse
 * succeeding at load time), since the tool has no way to know what shape a
 * given project's workflow/activity actually expects.
 */

export interface SignalConfig {
  name: string;
  payload: unknown;
}

export interface QueryConfig {
  name: string;
}

export interface UpdateConfig {
  name: string;
  validInput: unknown;
  invalidInput: unknown;
}

export interface WorkflowConfig {
  type: string;
  taskQueue: string;
  sampleInput?: unknown;
  isLongRunning?: boolean;
  usesTimers?: boolean;
  signals?: SignalConfig[];
  queries?: QueryConfig[];
  updates?: UpdateConfig[];
  sagaFailurePoint?: string;
  idempotencyTestActivity?: string;
  hasCleanupOnCancel?: boolean;
  hasChildWorkflows?: boolean;
  sensitiveDataFields?: string[];
  dependencyOutageTestActivity?: string;
}

export interface FeaturesConfig {
  childWorkflows?: boolean;
  nexus?: boolean;
  schedules?: boolean;
  /**
   * The workflow TYPE (not a schedule's own ID, despite the field name —
   * see d2.ts's doc comment for the full resolution) that D2/D3/D4 create
   * their own throwaway recurring Schedule against. Repurposed from the
   * spec's Appendix A example (`"daily-rollover-schedule"`, which reads
   * like an existing schedule to query) because querying a pre-existing
   * schedule is impossible here: `env` is always a fresh, unpersisted
   * `TestWorkflowEnvironment.createLocal()` server with no real
   * infrastructure behind it. Pick a fast, side-effect-light workflow —
   * these checks fire it repeatedly in a short real-time window.
   */
  scheduleWorkflowId?: string;
  searchAttributes?: boolean;
  customSearchAttributeKeys?: string[];
  localActivities?: boolean;
  updates?: boolean;
  updateWithStart?: boolean;
  workerVersioning?: boolean;
  customDataConverter?: boolean;
  dataConverterModulePath?: string | null;
}

/**
 * Optional per-check overrides for the internal "how long do we wait before
 * giving up" budgets each dynamic check uses. Every field's default is that
 * check's own hardcoded value (see the check file itself) — leaving this
 * whole block, or any individual check/field within it, unset produces
 * IDENTICAL behavior to before this existed. Deliberately per-check rather
 * than a shared/global timeout: same-valued constants across unrelated
 * checks are coincidence, not a shared meaning, so raising one must never
 * silently raise another. See
 * docs/superpowers/plans/2026-09-10-configurable-wait-budgets.md for the
 * full file-by-file audit this was built from, and CLAUDE.md's
 * "Configurable per-check wait budgets" section for the design reasoning.
 *
 * Deliberately excludes: poll intervals (internal loop cadence, not a
 * ceiling), d2/d3/d4's Schedule-cadence-derived waits (real test data, not
 * an arbitrary budget), and b4's LONG_ACTIVITY_THRESHOLD_MS (a grading
 * threshold, not a wait).
 */
export interface WaitBudgetsConfig {
  A1?: { waitTimeoutMs?: number };
  A4?: { waitTimeoutMs?: number };
  B3?: { resultWaitMs?: number };
  B4?: { runTimeoutMs?: number };
  B5?: { gracePeriodMs?: number };
  C1?: { queryWaitMs?: number };
  C2?: { queryTimeoutMs?: number };
  C3?: { queryTimeoutMs?: number };
  C5?: { responseWaitMs?: number };
  D1?: { resultWaitMs?: number };
  E1?: { resultWaitMs?: number };
  E2?: { queryWaitMs?: number; resultWaitMs?: number };
  F1?: { discoveryTimeoutMs?: number; resultWaitMs?: number };
  F2?: { childStartTimeoutMs?: number; policySettleTimeoutMs?: number };
  G1?: { resultWaitMs?: number };
  H1?: { resultWaitMs?: number };
  H2?: { graceMs?: number };
  H3?: { childStartTimeoutMs?: number; resultWaitMs?: number };
  I1?: { markerWaitTimeoutMs?: number; resultWaitMs?: number };
  I3?: { runTimeoutMs?: number };
  I4?: { correctQueueWaitMs?: number };
  I5?: { resultWaitMs?: number };
  J1?: { waitTimeoutMs?: number };
  J2?: { describeWaitMs?: number };
  J3?: { waitTimeoutMs?: number };
  K2?: { resultWaitMs?: number };
  L1?: { resultWaitMs?: number };
  L2?: { resultWaitMs?: number };
}

export interface TestKitConfig {
  project: string;
  workerEntryPoint: string;
  taskQueues: string[];
  workflows: WorkflowConfig[];
  features?: FeaturesConfig;
  waitBudgetsMs?: WaitBudgetsConfig;
  outputDir?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSignal(value: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    errors.push(`${path}.name is required and must be a string`);
  }
}

function validateQuery(value: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    errors.push(`${path}.name is required and must be a string`);
  }
}

function validateUpdate(value: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    errors.push(`${path}.name is required and must be a string`);
  }
  if (!("validInput" in value) || !("invalidInput" in value)) {
    errors.push(`${path} must have both validInput and invalidInput`);
  }
}

function validateStringArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    errors.push(`${path} must be an array of strings`);
  }
}

function validateWorkflow(wf: unknown, index: number, errors: string[]): void {
  if (!isPlainObject(wf)) {
    errors.push(`workflows[${index}] must be an object`);
    return;
  }
  const path = `workflows[${index}]`;

  if (typeof wf.type !== "string" || wf.type.length === 0) {
    errors.push(`${path}.type is required and must be a string`);
  }
  if (typeof wf.taskQueue !== "string" || wf.taskQueue.length === 0) {
    errors.push(`${path}.taskQueue is required and must be a string`);
  }

  if ("isLongRunning" in wf && typeof wf.isLongRunning !== "boolean") {
    errors.push(`${path}.isLongRunning must be a boolean`);
  }
  if ("usesTimers" in wf && typeof wf.usesTimers !== "boolean") {
    errors.push(`${path}.usesTimers must be a boolean`);
  }
  if ("hasCleanupOnCancel" in wf && typeof wf.hasCleanupOnCancel !== "boolean") {
    errors.push(`${path}.hasCleanupOnCancel must be a boolean`);
  }
  if ("hasChildWorkflows" in wf && typeof wf.hasChildWorkflows !== "boolean") {
    errors.push(`${path}.hasChildWorkflows must be a boolean`);
  }
  if ("sagaFailurePoint" in wf && typeof wf.sagaFailurePoint !== "string") {
    errors.push(`${path}.sagaFailurePoint must be a string`);
  }
  if ("idempotencyTestActivity" in wf && typeof wf.idempotencyTestActivity !== "string") {
    errors.push(`${path}.idempotencyTestActivity must be a string`);
  }
  if ("dependencyOutageTestActivity" in wf && typeof wf.dependencyOutageTestActivity !== "string") {
    errors.push(`${path}.dependencyOutageTestActivity must be a string`);
  }
  if ("sensitiveDataFields" in wf) {
    validateStringArray(wf.sensitiveDataFields, `${path}.sensitiveDataFields`, errors);
  }

  if ("signals" in wf) {
    if (!Array.isArray(wf.signals)) {
      errors.push(`${path}.signals must be an array`);
    } else {
      wf.signals.forEach((s, i) => validateSignal(s, `${path}.signals[${i}]`, errors));
    }
  }
  if ("queries" in wf) {
    if (!Array.isArray(wf.queries)) {
      errors.push(`${path}.queries must be an array`);
    } else {
      wf.queries.forEach((q, i) => validateQuery(q, `${path}.queries[${i}]`, errors));
    }
  }
  if ("updates" in wf) {
    if (!Array.isArray(wf.updates)) {
      errors.push(`${path}.updates must be an array`);
    } else {
      wf.updates.forEach((u, i) => validateUpdate(u, `${path}.updates[${i}]`, errors));
    }
  }
}

function validateFeatures(features: unknown, errors: string[]): void {
  if (!isPlainObject(features)) {
    errors.push("features must be an object");
    return;
  }
  const booleanFields = [
    "childWorkflows",
    "nexus",
    "schedules",
    "searchAttributes",
    "localActivities",
    "updates",
    "updateWithStart",
    "workerVersioning",
    "customDataConverter",
  ];
  for (const field of booleanFields) {
    if (field in features && typeof features[field] !== "boolean") {
      errors.push(`features.${field} must be a boolean`);
    }
  }
  if ("scheduleWorkflowId" in features && typeof features.scheduleWorkflowId !== "string") {
    errors.push("features.scheduleWorkflowId must be a string");
  }
  if ("customSearchAttributeKeys" in features) {
    validateStringArray(features.customSearchAttributeKeys, "features.customSearchAttributeKeys", errors);
  }
  if (
    "dataConverterModulePath" in features &&
    features.dataConverterModulePath !== null &&
    typeof features.dataConverterModulePath !== "string"
  ) {
    errors.push("features.dataConverterModulePath must be a string or null");
  }
}

const WAIT_BUDGET_FIELDS: Record<string, string[]> = {
  A1: ["waitTimeoutMs"],
  A4: ["waitTimeoutMs"],
  B3: ["resultWaitMs"],
  B4: ["runTimeoutMs"],
  B5: ["gracePeriodMs"],
  C1: ["queryWaitMs"],
  C2: ["queryTimeoutMs"],
  C3: ["queryTimeoutMs"],
  C5: ["responseWaitMs"],
  D1: ["resultWaitMs"],
  E1: ["resultWaitMs"],
  E2: ["queryWaitMs", "resultWaitMs"],
  F1: ["discoveryTimeoutMs", "resultWaitMs"],
  F2: ["childStartTimeoutMs", "policySettleTimeoutMs"],
  G1: ["resultWaitMs"],
  H1: ["resultWaitMs"],
  H2: ["graceMs"],
  H3: ["childStartTimeoutMs", "resultWaitMs"],
  I1: ["markerWaitTimeoutMs", "resultWaitMs"],
  I3: ["runTimeoutMs"],
  I4: ["correctQueueWaitMs"],
  I5: ["resultWaitMs"],
  J1: ["waitTimeoutMs"],
  J2: ["describeWaitMs"],
  J3: ["waitTimeoutMs"],
  K2: ["resultWaitMs"],
  L1: ["resultWaitMs"],
  L2: ["resultWaitMs"],
};

function validateWaitBudgets(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push("waitBudgetsMs must be an object");
    return;
  }
  for (const [checkId, entry] of Object.entries(value)) {
    const knownFields = WAIT_BUDGET_FIELDS[checkId];
    if (!knownFields) {
      errors.push(`waitBudgetsMs.${checkId} is not a recognized check ID with a configurable wait budget`);
      continue;
    }
    if (!isPlainObject(entry)) {
      errors.push(`waitBudgetsMs.${checkId} must be an object`);
      continue;
    }
    for (const [field, fieldValue] of Object.entries(entry)) {
      if (!knownFields.includes(field)) {
        errors.push(`waitBudgetsMs.${checkId}.${field} is not a recognized wait-budget field for ${checkId}`);
        continue;
      }
      if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue) || fieldValue <= 0) {
        errors.push(`waitBudgetsMs.${checkId}.${field} must be a positive number`);
      }
    }
  }
}

export function validateConfig(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null) {
    return { valid: false, errors: ["config must be a JSON object"] };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.project !== "string" || obj.project.length === 0) {
    errors.push("project is required and must be a string");
  }
  if (typeof obj.workerEntryPoint !== "string" || obj.workerEntryPoint.length === 0) {
    errors.push("workerEntryPoint is required and must be a string");
  }
  if (!Array.isArray(obj.taskQueues) || obj.taskQueues.some((q) => typeof q !== "string")) {
    errors.push("taskQueues is required and must be an array of strings");
  }
  if (!Array.isArray(obj.workflows)) {
    errors.push("workflows is required and must be an array");
  } else {
    obj.workflows.forEach((wf, i) => validateWorkflow(wf, i, errors));
  }

  if ("features" in obj) {
    validateFeatures(obj.features, errors);
  }
  if ("waitBudgetsMs" in obj) {
    validateWaitBudgets(obj.waitBudgetsMs, errors);
  }
  if ("outputDir" in obj && typeof obj.outputDir !== "string") {
    errors.push("outputDir must be a string");
  }

  return { valid: errors.length === 0, errors };
}
