import { describe, expect, it } from "vitest";
import { generateInitTemplate } from "./init-template.js";
import { stripJsonLineComments } from "./jsonc.js";
import { validateConfig } from "./schema.js";

describe("generateInitTemplate", () => {
  const template = generateInitTemplate();
  const parsed = JSON.parse(stripJsonLineComments(template));

  it("produces valid JSONC that parses after comment-stripping", () => {
    expect(parsed).toBeTypeOf("object");
  });

  it("produces a config that passes validateConfig", () => {
    const result = validateConfig(parsed);
    expect(result.valid).toBe(true);
  });

  it("includes every WorkflowConfig field from the schema on its example workflow entry", () => {
    // Every optional WorkflowConfig field (schema.ts), so init never silently
    // drifts behind the schema it's supposed to demonstrate.
    const fields = [
      "type",
      "taskQueue",
      "sampleInput",
      "isLongRunning",
      "usesTimers",
      "signals",
      "queries",
      "updates",
      "sagaFailurePoint",
      "idempotencyTestActivity",
      "hasCleanupOnCancel",
      "hasChildWorkflows",
      "sensitiveDataFields",
      "dependencyOutageTestActivity",
    ];
    const fullWorkflow = parsed.workflows[0];
    for (const field of fields) {
      expect(fullWorkflow, `missing workflows[0].${field}`).toHaveProperty(field);
    }
  });

  it("includes every FeaturesConfig field from the schema", () => {
    const fields = [
      "childWorkflows",
      "nexus",
      "schedules",
      "scheduleWorkflowId",
      "searchAttributes",
      "customSearchAttributeKeys",
      "localActivities",
      "updates",
      "updateWithStart",
      "workerVersioning",
      "customDataConverter",
      "dataConverterModulePath",
    ];
    for (const field of fields) {
      expect(parsed.features, `missing features.${field}`).toHaveProperty(field);
    }
  });

  it("comments scheduleWorkflowId with its ACTUAL current meaning (the workflow type checks schedule against), not the original spec's pre-existing-schedule framing", () => {
    // Repurposed during Phase 3 — see d2.ts's doc comment. init must not
    // ship a documented lie about what this field does now.
    const scheduleWorkflowIdIndex = template.indexOf('"scheduleWorkflowId"');
    expect(scheduleWorkflowIdIndex).toBeGreaterThan(-1);
    const context = template.slice(Math.max(0, scheduleWorkflowIdIndex - 500), scheduleWorkflowIdIndex + 100);
    expect(context).toMatch(/workflow type|creates its own/i);
    expect(template).not.toMatch(/scheduleWorkflowId[\s\S]{0,200}"daily-rollover-schedule"/);
  });

  it("includes a second, minimal workflow entry (only required fields) matching Appendix A's own example shape", () => {
    expect(parsed.workflows).toHaveLength(2);
    const minimal = parsed.workflows[1];
    expect(Object.keys(minimal).sort()).toEqual(["taskQueue", "type"]);
  });

  it("sets outputDir", () => {
    expect(parsed.outputDir).toBeTypeOf("string");
  });

  it("mentions waitBudgetsMs so a new project can discover the override exists", () => {
    expect(parsed).toHaveProperty("waitBudgetsMs");
    const idx = template.indexOf('"waitBudgetsMs"');
    expect(idx).toBeGreaterThan(-1);
    const context = template.slice(Math.max(0, idx - 600), idx);
    expect(context).toMatch(/wait budget|timeout|README/i);
  });
});
