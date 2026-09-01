import proto from "@temporalio/proto";
import { defineSearchAttributeKey, SearchAttributeType, TypedSearchAttributes } from "@temporalio/common";
import { CATALOG } from "../../../catalog.js";
import { DynamicFixtureCheckFn } from "../fixture-check.js";
import { isFixtureMissing, missingFixtureResult } from "../require-fixture.js";
import { generateWorkflowId } from "../workflow-id.js";
import { raceWithTimeout } from "../race.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "J2")!;
const IndexedValueType = proto.temporal.api.enums.v1.IndexedValueType;
const NAMESPACE = "default";
const DESCRIBE_WAIT_MS = 5_000;

/**
 * `features.searchAttributes` already gates N_A in the orchestrator; this
 * check additionally needs the actual key names to set/query once that
 * flag is true.
 *
 * RESOLVED (empirically, not assumed): the local ephemeral dev server
 * (`TestWorkflowEnvironment.createLocal()`) requires custom search
 * attribute keys to be pre-registered before a workflow can set them —
 * starting a workflow with an unregistered `typedSearchAttributes` key
 * fails with `INVALID_ARGUMENT: Namespace default has no mapping defined
 * for search attribute <name>`. Dynamic registration via
 * `env.connection.operatorService.addSearchAttributes()` works against the
 * local server, and once registered, a workflow started with
 * `typedSearchAttributes` set for that key is confirmed queryable via
 * `handle.describe()`.
 *
 * This means J2 needs ZERO cooperation from the target project's own
 * workflow code: it registers each configured key itself, starts
 * `target.type` with those keys set via the CLIENT (not requiring the
 * workflow to call `upsertSearchAttributes()` itself), and confirms via
 * `describe()` that they're set and queryable. Every configured key defaults
 * to KEYWORD type — the config schema carries no per-key type info (spec's
 * Appendix A only defines `features.customSearchAttributeKeys` as a plain
 * string array), so KEYWORD is the most broadly representative type this
 * check can pick without inventing config it doesn't have.
 *
 * Honesty bar (same as G1/L1/B3): a PASS here proves this project's
 * namespace/client setup correctly supports custom search attributes
 * generically — it does NOT prove the project's OWN workflow code ever
 * actually calls `upsertSearchAttributes()` for these keys in real usage.
 * This check sets the values itself via the client; it never observes the
 * target project doing so. The PASS message says this explicitly.
 */
export const checkJ2SearchAttributes: DynamicFixtureCheckFn = async (env, target, features) => {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.type,
    engine: "dynamic-fixture" as const,
  };

  if (isFixtureMissing(features.customSearchAttributeKeys)) {
    return missingFixtureResult(base, "features.customSearchAttributeKeys");
  }
  const keyNames = features.customSearchAttributeKeys as string[];

  // Each key gets its own generated test value so a mismatch (wrong key
  // read back, or a stale value from a previous run) is unambiguous.
  const testValues = new Map<string, string>(
    keyNames.map((name) => [name, `ttk-j2-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`]),
  );

  try {
    for (const name of keyNames) {
      try {
        await env.connection.operatorService.addSearchAttributes({
          namespace: NAMESPACE,
          searchAttributes: { [name]: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD },
        });
      } catch (e) {
        // Tolerate "already exists"-shaped errors: a previous check run
        // against this same shared `env` may have already registered this
        // key. Anything else is a real setup failure, not idempotency noise.
        const msg = (e as Error).message ?? "";
        if (!/already\s*(exists|registered)|already.*mapping|is already/i.test(msg)) {
          throw e;
        }
      }
    }
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not register custom search attribute key(s) (${keyNames.join(", ")}) against this namespace: ${(e as Error).message}`,
      hint:
        "This check registers each features.customSearchAttributeKeys entry itself via the operator service " +
        "before starting a workflow with it — this failure is about that registration step, not about the " +
        "target project's own code. Confirm the configured key name(s) are valid search attribute identifiers.",
    };
  }

  const searchAttributeKeys = keyNames.map((name) => defineSearchAttributeKey(name, SearchAttributeType.KEYWORD));
  const typedSearchAttributes = new TypedSearchAttributes(
    searchAttributeKeys.map((key, i) => ({ key, value: testValues.get(keyNames[i])! })),
  );

  const workflowId = generateWorkflowId("J2", target.type);
  const args = target.sampleInput !== undefined ? [target.sampleInput] : [];

  try {
    const handle = await env.client.workflow.start(target.type, {
      taskQueue: target.taskQueue,
      workflowId,
      args,
      typedSearchAttributes,
    });

    const description = await raceWithTimeout(handle.describe(), DESCRIBE_WAIT_MS, () => {
      throw new Error(`describe() did not resolve within ${DESCRIBE_WAIT_MS}ms`);
    });

    const mismatches: string[] = [];
    for (const key of searchAttributeKeys) {
      const actual = description.typedSearchAttributes.get(key);
      const expected = testValues.get(key.name);
      if (actual !== expected) {
        mismatches.push(`${key.name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }

    if (mismatches.length > 0) {
      return {
        ...base,
        status: "FAIL",
        message:
          `${target.type} was started with custom search attribute(s) set via the client, but handle.describe() ` +
          `did not confirm the expected value(s) for all of them: ${mismatches.join("; ")}.`,
        hint:
          "After registering each features.customSearchAttributeKeys entry and starting the workflow with " +
          "typedSearchAttributes set for it, describe() should reflect exactly those values. A mismatch here " +
          "points at this namespace's search-attribute indexing/propagation, not at the target project's own " +
          "workflow code (this check never asks it to call upsertSearchAttributes()).",
      };
    }

    return {
      ...base,
      status: "PASS",
      message:
        `Registered custom search attribute key(s) ${keyNames.join(", ")}, started ${target.type} with each set ` +
        "via the client, and confirmed handle.describe() reflects the exact values set. This proves this " +
        "project's namespace/client setup correctly supports custom search attributes generically — it does NOT " +
        "prove that this project's OWN workflow code ever actually calls upsertSearchAttributes() for these keys " +
        "in real usage: this check sets the values itself via the client, it never observes the target project " +
        "doing so.",
      hint: null,
    };
  } catch (e) {
    return {
      ...base,
      status: "FAIL",
      message: `Could not start ${target.type} with custom search attribute(s) ${keyNames.join(", ")} set, or confirm them via describe(): ${(e as Error).message}`,
      hint:
        `This check starts ${target.type} via the client with features.customSearchAttributeKeys set as ` +
        "typedSearchAttributes, after registering each key itself — this failure is about that setup, not about " +
        `search-attribute behavior itself. Confirm ${target.type} is a real, startable workflow and ` +
        "workflows[].sampleInput (if any) is valid for it.",
    };
  }
};
