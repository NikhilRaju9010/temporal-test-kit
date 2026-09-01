/**
 * Generates the starter `temporal-test-kit.config.json` `temporal-test-kit
 * init` writes out — a JSONC file (see `jsonc.ts` for why `loadConfig` can
 * read one back), every field commented with which test(s) it unlocks, per
 * the build spec's Appendix A and Section 4.1 ("filling anything blank just
 * means the tests it unlocks report SKIPPED, never a validation error").
 *
 * Kept as a hand-written string template (not built field-by-field off
 * `schema.ts`'s TypeScript types) because the comments ARE the point of this
 * file — a generated-from-types version would have no comments to generate.
 * `init-template.test.ts` is what keeps this in sync with `schema.ts`
 * instead: it asserts every `WorkflowConfig`/`FeaturesConfig` field appears
 * here, so an added-but-undocumented field fails a test instead of silently
 * drifting.
 *
 * `features.scheduleWorkflowId`'s comment describes its CURRENT, repurposed
 * meaning (the workflow type D2/D3/D4 create their own throwaway Schedule
 * against — see `d2.ts`'s doc comment for the full story), not the original
 * spec's "an existing schedule's ID" framing — that framing turned out to be
 * unbuildable against this tool's always-fresh ephemeral test environment,
 * and shipping the old wording here would document a lie.
 */
export function generateInitTemplate(): string {
  return `// temporal-test-kit.config.json
//
// This is what "temporal-test-kit init" generates as a starting template.
// Every field below shows WHICH test(s) it unlocks. Leave anything blank —
// those specific tests get marked SKIPPED, everything else still runs fine.

{
  "project": "your-project-name",
  "workerEntryPoint": "./src/worker.ts",
  "taskQueues": ["default"],

  "workflows": [
    {
      // ---- REQUIRED (nothing runs for this workflow without these two) ----
      "type": "OrderWorkflow",
      "taskQueue": "orders",

      // ---- Unlocks: A1 (happy path), A3 (ID reuse), A4 (serialization) ----
      "sampleInput": { "orderId": "TEST-001", "amount": 49.99 },

      // ---- Unlocks: E2 (Continue-As-New state preservation) ----
      // Only set true if this workflow is designed to loop/run for a long
      // time and reset itself via continueAsNew().
      "isLongRunning": false,

      // ---- Informational only; no check currently gates on this alone ----
      // Set true if this workflow uses sleep()/timers anywhere.
      "usesTimers": true,

      // ---- Unlocks: C1 (signal handling), C5 (doesn't get stuck) ----
      // List every signal this workflow listens for, with a sample payload.
      "signals": [
        { "name": "cancelOrder", "payload": {} },
        { "name": "applyDiscount", "payload": { "percent": 10 } }
      ],

      // ---- Unlocks: C2 (query read-only check) ----
      "queries": [
        { "name": "getStatus" }
      ],

      // ---- Unlocks: C3 (update validator, needs features.updates: true),
      // C4 (update-with-start, needs features.updateWithStart: true), C5 ----
      "updates": [
        {
          "name": "changeAddress",
          "validInput": { "address": "123 Main St" },
          "invalidInput": { "address": "" }
        }
      ],

      // ---- Unlocks: G1 (saga/compensation check) ----
      // Name the activity where, if it fails, earlier steps should roll back.
      // G1 forces this activity to fail (a real, worker-level substitution —
      // your code never needs to cooperate) and confirms the workflow
      // reaches a clean terminal FAILED state, not a silently-swallowed one.
      "sagaFailurePoint": "chargeCardActivity",

      // ---- Unlocks: B3 (idempotency/retry-recovery check) ----
      // Name an activity that writes/changes real data (email, DB write, charge).
      // B3 forces it to be reattempted after an apparent success and confirms
      // the WORKFLOW still completes — it does NOT prove the activity's own
      // real-world side effect is deduplicated (that depends on your
      // activity's own code, which this tool can't see into).
      "idempotencyTestActivity": "sendConfirmationEmailActivity",

      // ---- Unlocks: H1 (cancel runs cleanup) ----
      "hasCleanupOnCancel": true,

      // ---- Unlocks: F1, F2, H3 (child workflow checks, needs features.childWorkflows: true) ----
      "hasChildWorkflows": false,

      // ---- Unlocks: K2 (sensitive data protection) ----
      // List field names in this workflow's OWN sampleInput above that
      // should NEVER appear in plain text in the workflow history.
      "sensitiveDataFields": ["cardNumber", "cvv"],

      // ---- Unlocks: L2 (dependency outage recovery) ----
      // Name one activity that calls an external service/DB, so the tool can
      // simulate that dependency going down (and recovering) and confirm the
      // workflow recovers.
      "dependencyOutageTestActivity": "chargeCardActivity"
    },

    {
      // A minimal example — only the required fields filled in.
      // This is completely fine. Fewer fixture-gated tests will run for this
      // workflow, but all 21 zero-dependency tests (static + zero-fixture
      // dynamic) still run normally for it.
      "type": "NotifyUserWorkflow",
      "taskQueue": "notifications"
    }
  ],

  // ---- Project-wide feature flags ----
  // These tell the tool which OPTIONAL Temporal features you use at all.
  // Leave as false if unused — those tests get marked N/A (not "skipped"),
  // since N/A means "doesn't apply here," not "missing info."
  "features": {
    "childWorkflows": false,
    "nexus": false,

    // Unlocks: D2, D3, D4 (schedule tests)
    "schedules": true,
    // The workflow TYPE (above, in workflows[]) that D2/D3/D4 should create
    // their own throwaway recurring Schedule against, to test scheduling
    // behavior. NOT an existing schedule's own ID — this tool's test
    // environment is always a fresh, ephemeral local server with no
    // pre-existing schedules to query, so it brings its own. Pick a fast,
    // side-effect-light workflow; these checks fire it repeatedly in a
    // short real-time window.
    "scheduleWorkflowId": "OrderWorkflow",

    // Unlocks: J2 (search attributes) — this tool registers these keys
    // itself against the local test server, so your code doesn't need to
    // call upsertSearchAttributes() for this check to run (though J2 can't
    // confirm your OWN code ever does, either — only that the mechanism works).
    "searchAttributes": true,
    "customSearchAttributeKeys": ["OrderStatus", "CustomerTier"],

    "localActivities": false,

    // Unlocks: C3 (update validator)
    "updates": true,
    // Unlocks: C4 (update-with-start)
    "updateWithStart": false,

    "workerVersioning": false,

    // Unlocks: K1 (data converter round-trip) — only needed if you have a
    // CUSTOM converter. If false, the tool just tests the default one.
    "customDataConverter": false,
    "dataConverterModulePath": null
  },

  "outputDir": "./temporal-test-kit-report"
}
`;
}
