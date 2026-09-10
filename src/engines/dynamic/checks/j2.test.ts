import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { EphemeralEnvironment, withEphemeralEnvironment } from "../environment.js";
import { checkJ2SearchAttributes } from "./j2.js";

const FAKE_ENV = {} as EphemeralEnvironment;
const baseTarget = { type: "OrderWorkflow", taskQueue: "orders", workflowsPath: "/x", activities: {} };

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "..", "examples", "sample-project");
const WORKFLOWS_PATH = join(SAMPLE_PROJECT, "src", "workflows.ts");

async function loadActivities() {
  return import(join(SAMPLE_PROJECT, "src", "activities.ts"));
}

describe("checkJ2SearchAttributes — SKIPPED when its fixture is missing", () => {
  it("skips with a hint naming features.customSearchAttributeKeys when unset", async () => {
    const result = await checkJ2SearchAttributes(FAKE_ENV, baseTarget, { searchAttributes: true });
    expect(result.status).toBe("SKIPPED");
    expect(result.id).toBe("J2");
    expect(result.hint).toContain("features.customSearchAttributeKeys");
  });

  it("skips when customSearchAttributeKeys is an empty array", async () => {
    const result = await checkJ2SearchAttributes(FAKE_ENV, baseTarget, {
      searchAttributes: true,
      customSearchAttributeKeys: [],
    });
    expect(result.status).toBe("SKIPPED");
  });
});

describe("checkJ2SearchAttributes (real @temporalio/testing + sample project's GreetingWorkflow)", () => {
  it("registers the configured custom search attribute key, starts the workflow with a value set via the client, and confirms it's queryable via describe()", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkJ2SearchAttributes(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-j2-test",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
        },
        { customSearchAttributeKeys: ["TTK_OrderStatus"] },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.id).toBe("J2");
    expect(result.hint).toBeNull();
    expect(result.message).toContain("TTK_OrderStatus");
    // Honesty bar: PASS here proves the namespace/client setup supports
    // custom search attributes generically — this check sets the values
    // itself via the client, it never observes the project's OWN workflow
    // code calling upsertSearchAttributes(). The message must say so
    // explicitly, not just internally reason about it.
    expect(result.message).toMatch(/does not|doesn't|never/i);
  }, 30_000);

  it("registers multiple configured keys and confirms all of them are set and queryable", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkJ2SearchAttributes(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-j2-test-multi",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
        },
        { customSearchAttributeKeys: ["TTK_OrderStatus", "TTK_Region"] },
      ),
    );

    expect(result.status).toBe("PASS");
    expect(result.message).toContain("TTK_OrderStatus");
    expect(result.message).toContain("TTK_Region");
  }, 30_000);

  it("tolerates re-registering an already-registered key across two checks sharing the same env (no false FAIL)", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment(async (env) => {
      // Run it once to get the key registered against this shared env...
      await checkJ2SearchAttributes(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-j2-test-dup-1",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
        },
        { customSearchAttributeKeys: ["TTK_OrderStatus"] },
      );
      // ...then run it again against the SAME env/namespace, same key.
      return checkJ2SearchAttributes(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-j2-test-dup-2",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
        },
        { customSearchAttributeKeys: ["TTK_OrderStatus"] },
      );
    });

    expect(result.status).toBe("PASS");
  }, 30_000);

  it("honors a waitBudgetsMs.J2.describeWaitMs override instead of the hardcoded default", async () => {
    const activities = await loadActivities();

    const result = await withEphemeralEnvironment((env) =>
      checkJ2SearchAttributes(
        env,
        {
          type: "GreetingWorkflow",
          taskQueue: "ttk-j2-test-override",
          workflowsPath: WORKFLOWS_PATH,
          activities,
          sampleInput: "TTK",
        },
        { customSearchAttributeKeys: ["TTK_OrderStatus"] },
        undefined,
        { J2: { describeWaitMs: 1 } },
      ),
    );

    expect(result.status).toBe("FAIL");
    expect(result.message).toMatch(/1ms/);
  }, 30_000);
});
