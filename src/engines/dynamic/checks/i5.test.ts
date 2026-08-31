import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment } from "../environment.js";
import { checkI5StickyRecovery } from "./i5.js";

describe("checkI5StickyRecovery (real @temporalio/worker + @temporalio/testing)", () => {
  it(
    "passes when a fresh worker picks up the workflow's next task after the original worker shuts down",
    async () => {
      const result = await withEphemeralEnvironment((env) =>
        checkI5StickyRecovery(env, {
          workflowType: "irrelevant-not-used-by-this-check",
          taskQueue: "irrelevant-not-used-by-this-check",
          workflowsPath: join(import.meta.dirname, "fixtures", "i5-two-task-workflow.ts"),
          activities: {},
        }),
      );

      expect(result.status).toBe("PASS");
      expect(result.id).toBe("I5");
      expect(result.hint).toBeNull();
      expect(result.message).toMatch(/new worker/i);
    },
    30_000,
  );
});
