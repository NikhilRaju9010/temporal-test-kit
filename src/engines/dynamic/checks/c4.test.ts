import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkC4UpdateWithStart } from "./c4.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkC4UpdateWithStart — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming workflows[].updates when unset", async () => {
    const result = await checkC4UpdateWithStart(FAKE_ENV, baseTarget, { updateWithStart: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("C4");
    expect(result.hint).toContain("workflows[].updates");
  });
});

describe("checkC4UpdateWithStart (real @temporalio/testing + sample project's InteractiveWorkflow)", () => {
  it("calls update-with-start twice against the same workflow ID and confirms only one execution was started", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkC4UpdateWithStart(
        env,
        {
          type: "InteractiveWorkflow",
          taskQueue: "ttk-c4-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
          updates: [{ name: "changeStateUpdate", validInput: "NewName", invalidInput: "" }],
        },
        { updateWithStart: true },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("C4");
    expect(result.hint).toBeNull();
  }, 30_000);
});
