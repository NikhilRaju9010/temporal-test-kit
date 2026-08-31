import { describe, expect, it } from "vitest";
import { withEphemeralEnvironment } from "../environment.js";
import { checkE1ContinueAsNew } from "./e1.js";

describe("checkE1ContinueAsNew (real @temporalio/testing, no mocking)", () => {
  it("passes when the probe workflow continues-as-new and ultimately completes", async () => {
    const result = await withEphemeralEnvironment((env) =>
      checkE1ContinueAsNew(env, {
        // E1 doesn't exercise the target's own workflow — see the doc
        // comment in e1.ts, same reasoning as D1. These fields are only
        // here to keep the shared WorkerTarget & { workflowType } shape;
        // the check ignores them and uses its own internal probe fixture.
        workflowType: "SomeTargetWorkflow",
        taskQueue: "irrelevant",
        workflowsPath: "irrelevant",
        activities: {},
      }),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("E1");
    expect(result.target).toBe("E1ContinueAsNewWorkflow (internal probe)");
    expect(result.hint).toBeNull();
    expect(result.message).toMatch(/continue-as-new/i);
  }, 30_000);
});
