import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "C2")!;

/**
 * C2 starts the workflow and calls the first configured `workflows[].queries[]`
 * entry TWICE in a row, with no signal/update/other interaction in between,
 * then compares the two results by deep (structural) equality. Temporal's
 * own SDK already enforces that a query handler can't mutate durable
 * workflow state (that's a language-level guarantee, not something worth
 * re-testing here) — what this check actually catches is a query handler
 * with an OBSERVABLE side effect on its OWN return value across repeated
 * calls (e.g. an accidentally-exposed counter that increments every time
 * it's read), which the SDK's mutation guard does nothing to prevent.
 */
export const checkC2Queries: DynamicFixtureCheckFn = async (env, target) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(target.queries)) {
    return missingFixtureResult(base, "workflows[].queries");
  }
  const queryName = target.queries![0].name;

  const workflowId = generateWorkflowId("C2", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  try {
    return await withRunningWorker(env, target, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });

      try {
        const first = await handle.query(queryName);
        const second = await handle.query(queryName);

        if (JSON.stringify(first) !== JSON.stringify(second)) {
          return {
            ...base,
            status: "FAIL" as const,
            message: `${queryName} returned different results on two consecutive calls with nothing else interacting with the workflow in between.`,
            hint:
              `A query handler should be a pure read of current state — calling ${queryName} twice with no ` +
              "signal/update/timer firing in between should return identical results. A changing result usually " +
              "means the handler itself has an observable side effect (e.g. it increments a counter, reads " +
              `wall-clock time, or reads something outside the workflow's own tracked state). Compare: ` +
              `${JSON.stringify(first)} vs. ${JSON.stringify(second)}.`,
          };
        }

        return {
          ...base,
          status: "PASS" as const,
          message: `${queryName} returned identical results on two consecutive calls with nothing else interacting with the workflow in between — no observable side effect from repeated querying.`,
          hint: null,
        };
      } finally {
        await handle.cancel().catch(() => {});
      }
    });
  } catch (e) {
    return {
      ...base,
      status: "FAIL" as const,
      message: `Could not query ${target.type}'s "${queryName}" query: ${(e as Error).message}`,
      hint:
        `This check starts ${target.type} and calls the first entry in workflows[].queries by name via the ` +
        `client. This failure is about setting that up, not about query behavior itself — confirm "${queryName}" ` +
        `matches a real setHandler() registration in ${target.type}, and that workflows[].sampleInput is valid ` +
        "for it.",
    };
  }
};
