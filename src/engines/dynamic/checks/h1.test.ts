import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkH1CancelRunsCleanup } from "./h1.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "InteractiveWorkflow", taskQueue: "interactive", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkH1CancelRunsCleanup — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].hasCleanupOnCancel when unset", async () => {
    const result = await checkH1CancelRunsCleanup(FAKE_ENV, baseTarget, {});
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("H1");
    expect(result.hint).toContain("workflows[].hasCleanupOnCancel");
  });

  it("skips when hasCleanupOnCancel is explicitly false", async () => {
    const result = await checkH1CancelRunsCleanup(FAKE_ENV, { ...baseTarget, hasCleanupOnCancel: false }, {});
    expect(result.status).toBe("SKIPPED");
  });
});

describe("checkH1CancelRunsCleanup (real @temporalio/testing + sample project's InteractiveWorkflow)", () => {
  it("cancels the workflow and confirms it reaches CANCELED and cleanupActivity actually ran (found in event history)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkH1CancelRunsCleanup(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-h1-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          hasCleanupOnCancel: true,
        },
        {},
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("H1");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/cleanupActivity/);
  }, 30_000);
});
