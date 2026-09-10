import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkC2Queries } from "./c2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkC2Queries — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].queries when unset", async () => {
    const result = await checkC2Queries(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C2");
    expect(result.hint).toContain("workflows[].queries");
  });
});

describe("checkC2Queries (real @temporalio/testing + sample project's InteractiveWorkflow)", () => {
  it("queries state twice with no interaction in between and confirms the results are identical", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC2Queries(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c2-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          queries: [{ name: "getStateQuery" }],
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("C2");
    expect(result.hint).toBeNull();
  }, 30_000);

  it("reports FAIL when a configured query name doesn't exist on the workflow", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC2Queries(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c2-test-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          queries: [{ name: "noSuchQuery" }],
        },
        {},
      ),
    );

    expect(result.status).toBe("FAIL");
  }, 30_000);

  it("honors a waitBudgetsMs.C2.queryTimeoutMs override instead of the hardcoded default", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC2Queries(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c2-test-3",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          queries: [{ name: "getStateQuery" }],
        },
        {},
        undefined,
        { C2: { queryTimeoutMs: 1 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/1ms/);
  }, 30_000);
});
