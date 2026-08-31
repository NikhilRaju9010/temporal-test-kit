import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment, bootWorker } from "./environment.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "examples", "sample-project");

describe("bootWorker + environment teardown (real @temporalio/testing)", () => {
  it("boots the sample project's worker and tears down the environment without throwing", async () => {
    await withEphemeralEnvironment(async (env) => {
      const activities = await import(join(SAMPLE_PROJECT, "src", "activities.ts"));
      const result = await bootWorker(env, {
        workflowsPath: join(SAMPLE_PROJECT, "src", "workflows.ts"),
        activities,
        taskQueue: "default",
      });
      expect(result.booted).toBe(true);
      expect(result.error).toBeNull();
      // Regression test for: "IllegalStateError: Cannot close connection while
      // Workers hold a reference to it" — teardown must succeed after boot.
    });
  });
});
