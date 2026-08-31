/**
 * Minimal config schema for Phase 2a: only the fields the preflight and
 * dynamic-zero-fixture engines need. The full Appendix A fixture schema
 * (signals, updates, sensitiveDataFields, features, etc.) is Phase 3 scope.
 */

export interface WorkflowConfig {
  type: string;
  taskQueue: string;
}

export interface TestKitConfig {
  project: string;
  workerEntryPoint: string;
  taskQueues: string[];
  workflows: WorkflowConfig[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
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
    obj.workflows.forEach((wf, i) => {
      if (typeof wf !== "object" || wf === null) {
        errors.push(`workflows[${i}] must be an object`);
        return;
      }
      const w = wf as Record<string, unknown>;
      if (typeof w.type !== "string" || w.type.length === 0) {
        errors.push(`workflows[${i}].type is required and must be a string`);
      }
      if (typeof w.taskQueue !== "string" || w.taskQueue.length === 0) {
        errors.push(`workflows[${i}].taskQueue is required and must be a string`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}
