# Configurable Per-Check Wait Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. **Do NOT use subagent-driven-development for Task 1** (the
> mechanical codemod) — see "Execution approach" below for why. Every task in
> this plan is meant to run inline, in one session; there is no
> file-partitioning benefit to subagents here since Task 1 already produces
> all 26 of its diffs in one script pass.
>
> **Execution order is NOT the task numbering below** — Task 3's Step 1
> (capture the baseline test run) must happen FIRST, before Task 0. The full
> real sequence is: **Task 3 Step 1 → Task 0 → Task 1 → Task 2 → Task 3
> Steps 2-3 → Task 4 → Task 5 → Task 6 → Task 7.** Tasks are numbered by
> subject-matter grouping (shared plumbing, codemod, exceptions, regression
> proof, new tests, docs, verification), not by run order — do not execute
> them in numeric order.

**Goal:** Make every genuine "how long do we wait before giving up" constant
in the dynamic checks configurable via an optional `waitBudgetsMs` block in
`temporal-test-kit.config.json`, keyed per check ID, defaulting to today's
hardcoded values so a project with no config change sees zero behavior
change.

**Architecture:** Each check file keeps its own hardcoded constant as the
literal default. A new `WaitBudgetsConfig` type (one optional sub-object per
check ID, each field named after that check's own local constant) is threaded
from `TestKitConfig.waitBudgetsMs` through `cli.ts`'s two orchestration loops
into every check function, which resolves `override ?? DEFAULT` for its own
slice only. No shared "category" defaults, no central defaults table — the
fallback IS the pre-existing per-file constant, so there is nothing to drift
out of sync.

**Tech Stack:** TypeScript, Vitest, Node.js. No new dependencies.

**Spec:** `/home/technoidentity-com/Downloads/001temporal-test-kit-build-spec-FINAL.md`
(Appendix A config schema, Section 4.1 SKIPPED-not-error philosophy) and this
repo's `CLAUDE.md` (per-check timeout/error-isolation conventions, file-per-
test-ID convention, worker-lifecycle rules).

## Global Constraints

- Every check's own hardcoded value today is the DEFAULT — a config with no
  `waitBudgetsMs` (or missing the field for a specific check) must produce
  byte-identical behavior to before this change. This is the actual
  acceptance bar, verified in Task 3 by re-running every existing test file
  UNCHANGED and diffing the pass/fail set against a pre-change baseline.
- Config keys are per-check, per-constant — never a shared category, per the
  approved design (leaky-abstraction risk: same-valued constants across
  unrelated checks are coincidence, not shared meaning).
- Poll intervals, `d2.ts`/`d3.ts`/`d4.ts`'s Schedule-cadence-derived waits,
  and `b4.ts`'s `LONG_ACTIVITY_THRESHOLD_MS` grading threshold are explicitly
  OUT of scope (see "Scope decisions" below) — do not add config plumbing for
  these.
- `ZeroFixtureCheckFn`/`DynamicFixtureCheckFn` gain a new parameter; every
  check file that needs it must accept it in the exact position specified in
  the per-file table (Task 2) — position matters because these are positional
  call sites in `cli.ts`, not named-argument calls.
- **`waitBudgets` MUST be appended as the trailing-most parameter, after
  `signal`, never inserted before it.** Discovered live during Task 0
  execution (not assumed up front): both check-fn types are consumed by
  arrow functions assigned directly via `: DynamicFixtureCheckFn`/etc, whose
  untyped positional params get their types via TypeScript's CONTEXTUAL
  inference from that type. Inserting a new param BEFORE the existing
  `signal` position silently retypes every existing arrow-typed check's
  `signal` parameter to `WaitBudgetsConfig` — with no error at the
  declaration site — for every check using that type, including ones never
  touched by this change (confirmed concretely: `c4.ts`, which has no
  wait-budget constant at all and isn't part of the 28-file list, broke this
  way and only surfaced because `tsc --noEmit` was run immediately after
  Task 0's type change, before any check file was edited). Appending at the
  end instead means every UNTOUCHED check's existing params keep their exact
  position and meaning — only files that explicitly add a new trailing param
  are affected. The corollary: the 5 files with no existing `signal` param
  (`d1.ts`, `i1.ts`, `i5.ts`, `l1.ts` zero-fixture; `j2.ts` fixture) must add
  an explicit `_signal?: AbortSignal,` PLACEHOLDER param before their own
  `waitBudgets?: WaitBudgetsConfig,` — skipping straight to `waitBudgets` as
  their "next" param would silently bind it to whatever value is actually
  passed in the `signal` call position instead.
- `runCheckWithGuards`'s own 15s default per-check ceiling
  (`DEFAULT_CHECK_TIMEOUT_MS` in `run-check.ts`) and the explicit
  `timeoutMs` overrides in `ZERO_FIXTURE_CHECKS`/`DYNAMIC_FIXTURE_CHECKS`
  (`cli.ts`) are a SEPARATE, orchestrator-level concept from a check's own
  internal wait budget and are NOT part of this change — a user raising, say,
  I1's `resultWaitMs` past the orchestrator's existing 40s override for I1
  would still get ERRORED from the orchestrator timeout, which is correct
  and expected (out of scope here, not a bug to fix).

---

## Full audit: every hardcoded wait-budget constant (confirmed via grep, not assumed)

28 files, 33 constants total. This supersedes the "~24 files" estimate from
the earlier design-approval message — the real count, re-verified with
`grep -rlE` against the full constant-name list, is 28.

| # | File | Constant(s) | Current value(s) | New config key(s) under `waitBudgetsMs.<ID>` | Threading shape |
|---|------|-------------|-------------------|-----------------------------------------------|------------------|
| 1 | `a1.ts` | `WAIT_TIMEOUT_MS` | 8000 | `waitTimeoutMs` | simple |
| 2 | `a4.ts` | `WAIT_TIMEOUT_MS` | 5000 | `waitTimeoutMs` | simple |
| 3 | `b3.ts` | `RESULT_WAIT_MS` | 10000 | `resultWaitMs` | simple |
| 4 | `b4.ts` | `RUN_TIMEOUT_MS` | 10000 | `runTimeoutMs` | **helper-threaded** (see Task 2b) |
| 5 | `b5.ts` | `GRACE_PERIOD_MS` | 5000 | `gracePeriodMs` | simple |
| 6 | `c1.ts` | `QUERY_WAIT_MS` | 5000 | `queryWaitMs` | simple |
| 7 | `c2.ts` | `QUERY_TIMEOUT_MS` | 5000 | `queryTimeoutMs` | simple |
| 8 | `c3.ts` | `QUERY_TIMEOUT_MS` | 5000 | `queryTimeoutMs` | simple |
| 9 | `c5.ts` | `RESPONSE_WAIT_MS` | 8000 | `responseWaitMs` | simple |
| 10 | `d1.ts` | `RESULT_WAIT_MS` | 10000 | `resultWaitMs` | simple, no existing `signal` param |
| 11 | `e1.ts` | `RESULT_WAIT_MS` | 15000 | `resultWaitMs` | simple |
| 12 | `e2.ts` | `QUERY_WAIT_MS`, `RESULT_WAIT_MS` | 5000, 10000 | `queryWaitMs`, `resultWaitMs` | simple, 2 keys |
| 13 | `f1.ts` | `DISCOVERY_TIMEOUT_MS`, `RESULT_WAIT_MS` | 6000, 10000 | `discoveryTimeoutMs`, `resultWaitMs` | simple, 2 keys |
| 14 | `f2.ts` | `CHILD_START_TIMEOUT_MS`, `POLICY_SETTLE_TIMEOUT_MS` | 6000, 8000 | `childStartTimeoutMs`, `policySettleTimeoutMs` | simple, 2 keys |
| 15 | `g1.ts` | `RESULT_WAIT_MS` | 10000 | `resultWaitMs` | simple |
| 16 | `h1.ts` | `RESULT_WAIT_MS` | 10000 | `resultWaitMs` | simple |
| 17 | `h2.ts` | `DEFAULT_GRACE_MS` | 5000 | `graceMs` | **helper-threaded** (see Task 2a) |
| 18 | `h3.ts` | `CHILD_START_TIMEOUT_MS`, `RESULT_WAIT_MS` | 6000, 10000 | `childStartTimeoutMs`, `resultWaitMs` | simple, 2 keys |
| 19 | `i1.ts` | `MARKER_WAIT_TIMEOUT_MS`, `RESULT_WAIT_MS` | 10000, 25000 | `markerWaitTimeoutMs`, `resultWaitMs` | simple, 2 keys, no existing `signal` param |
| 20 | `i3.ts` | `RUN_TIMEOUT_MS` | 10000 | `runTimeoutMs` | simple |
| 21 | `i4.ts` | `CORRECT_QUEUE_WAIT_MS` | 5000 | `correctQueueWaitMs` | simple |
| 22 | `i5.ts` | `RESULT_WAIT_MS` | 10000 | `resultWaitMs` | simple, no existing `signal` param |
| 23 | `j1.ts` | `WAIT_TIMEOUT_MS` | 8000 | `waitTimeoutMs` | simple |
| 24 | `j2.ts` | `DESCRIBE_WAIT_MS` | 5000 | `describeWaitMs` | simple, no existing `signal` param |
| 25 | `j3.ts` | `WAIT_TIMEOUT_MS` | 8000 | `waitTimeoutMs` | simple |
| 26 | `k2.ts` | `RESULT_WAIT_MS` | 10000 | `resultWaitMs` | simple |
| 27 | `l1.ts` | `RESULT_WAIT_MS` | 10000 | `resultWaitMs` | simple, no existing `signal` param |
| 28 | `l2.ts` | `RESULT_WAIT_MS` | 10000 | `resultWaitMs` | simple |

"simple" = the constant is used only inside the file's single top-level
exported check function; the fix is a local resolved variable at the top of
that function's body plus substituting usages within that function. 26 of
28 files are this shape. `b4.ts` and `h2.ts` are the two exceptions where the
constant is actually consumed by a separate, independently-exported helper
function (`recordActivityExecutions`, `terminateAndAwaitTerminated`) called
BY the check — those get their own hand-written task (Task 2, part b/a)
instead of the scripted pass.

### Confirmed out of scope, with reasoning (do not touch)

- **Poll intervals**: `POLL_INTERVAL_MS` (`b4.ts`, `b5.ts`), `*_POLL_INTERVAL_MS`
  (`e2.ts`, `f1.ts`, `f2.ts`, `h3.ts`, `i1.ts`), `DEFAULT_POLL_INTERVAL_MS`
  (`h2.ts`), `STARTUP_WAIT_MS` (`i5.ts`, `l1.ts`), `ACTIVITY_DELAY_MS` (`i1.ts`).
  These are internal loop cadence (50-300ms), not a ceiling a slow CI
  environment would need raised — the thing that needs raising is the
  overall wait, which is already covered by the constants above.
- **`d2.ts`/`d3.ts`/`d4.ts`'s `INTERVAL_MS`/`WAIT_MS`/`WINDOW_MS`/
  `PROMPTNESS_TOLERANCE_MS`**: derived from real Schedule cron cadence
  (`WAIT_MS = INTERVAL_MS * N + 2000`), already documented in CLAUDE.md as
  inherent wall-clock cost of what the check is testing. Overriding one
  piece without the others breaks the check's own arithmetic; these aren't
  "budgets," they're the check's actual test data.
- **`i4.ts`'s `WRONG_QUEUE_WAIT_MS`** (2500): a fixed negative-control margin
  (exactly half of `CORRECT_QUEUE_WAIT_MS`), not an independent knob — it's
  meant to be short precisely because the check expects nothing to arrive.
  Left hardcoded.
- **`b4.ts`'s `LONG_ACTIVITY_THRESHOLD_MS`** (2000): a grading threshold
  ("how long counts as long"), not a wait budget — it decides which activity
  executions the check judges, not how long the check waits.

---

## Execution approach — inline + one script, NOT subagent-driven

**Answering the two questions raised before writing this plan:**

**1. Is this scriptable?** Mostly yes, and the mechanical part should be a
single script, not 28 independent edits (subagent or manual). Reasoning:

- The diff for 26 of the 28 files is fully determined by three facts already
  in the table above: the constant's exact name, the catalog ID, and the new
  key name. There is zero judgment left to make per file — a script produces
  identical treatment everywhere, where 26-28 separate LLM calls (subagent or
  otherwise) each independently "doing the same edit" have a real chance of
  one going subtly off-script: a slightly different key name, a missed usage
  site in a file with 4+ occurrences (e.g. `b5.ts` has `GRACE_PERIOD_MS` in 4
  places), or forgetting the signature change in a file with no existing
  `signal` param (5 of the 28 — easy to miss if working file-by-file from
  memory of "the usual pattern").
- The two shared files this touches — `fixture-check.ts`'s
  `DynamicFixtureCheckFn` type and `cli.ts`'s `ZeroFixtureCheckFn` type plus
  its two call sites — are edited by EVERY one of the 28 changes. That's a
  shared-resource conflict that doesn't exist in this repo's usual
  parallel-subagent work (CLAUDE.md's own file-per-test-ID rationale for safe
  parallelization explicitly depends on checks "never touch[ing] the same
  file" — this task violates that precondition for these two files). Editing
  them once, by hand, before running anything else avoids that entirely.
- `b4.ts` and `h2.ts` are genuinely NOT mechanical (the wait constant is
  consumed by a helper function, not the check itself) — these get real,
  hand-written edits, not script output.

So: Task 0 hand-edits the two shared type/wiring files once. Task 1 writes
and runs one Node script (`scratchpad`, not committed — it's a one-time
transform, not a tool this repo needs going forward) that mechanically
applies the resolution-line-plus-substitution edit to the 26 "simple" files
using the table above as its literal input data. Task 2 hand-edits the two
exceptions. Every one of the 28 diffs is then reviewed with `git diff`
before any test is run.

**Recommendation: run Task 1's script and review its output inline, in this
session — do not dispatch subagents for it.** A subagent per file buys
nothing here (no independent judgment is needed, so there's no benefit to
having 28 separate "reviewers"), and dispatching one subagent to write and
run the shared script is just an extra hop for something faster to do
directly. Tasks are laid out below for `executing-plans`-style sequential
execution in this session.

**2. Does "one test per check" prove the DEFAULT case too?** Yes — Task 4 is
explicit about this and is a separate, first-class step, not folded silently
into "add the override test": before touching any check file, the full
existing suite is run once and its pass/fail set is captured as the
baseline. After all 28 files are changed (Task 1 + Task 2) but BEFORE the
new override tests are added (Task 3), the full suite is run again with
every existing test file completely unmodified — the acceptance bar is that
this second run's pass/fail set is IDENTICAL to the baseline. Only after
that's confirmed does Task 3 add one new test per file exercising the
override path. This ordering matters: it proves the default-path change is
behavior-preserving on its own, before any new test could mask a default-path
regression.

---

## Task 0: Shared types, schema, and cli.ts wiring

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/engines/dynamic/fixture-check.ts`
- Modify: `src/cli.ts` (the `ZeroFixtureCheckFn` type definition, the
  `DYNAMIC_FIXTURE_CHECKS`/`ZERO_FIXTURE_CHECKS` call sites)
- Test: `src/config/schema.test.ts`

**Interfaces:**
- Produces: `WaitBudgetsConfig` (exported from `src/config/schema.ts`), added
  as `TestKitConfig.waitBudgetsMs?: WaitBudgetsConfig`.
- Produces: `ZeroFixtureCheckFn` becomes `(env, target, waitBudgets?:
  WaitBudgetsConfig, signal?: AbortSignal) => Promise<TestResult>`.
- Produces: `DynamicFixtureCheckFn` becomes `(env, target, features,
  waitBudgets?: WaitBudgetsConfig, signal?: AbortSignal) =>
  Promise<TestResult>`.
- Consumes (Task 1/2): every check file reads its own slice via
  `waitBudgets?.<ID>?.<key> ?? DEFAULT_CONSTANT`.

- [ ] **Step 1: Write the failing schema test**

Add to `src/config/schema.test.ts`:

```ts
describe("waitBudgetsMs", () => {
  it("accepts a config with no waitBudgetsMs at all", () => {
    const result = validateConfig({
      project: "p",
      workerEntryPoint: "./w.ts",
      taskQueues: ["q"],
      workflows: [{ type: "T", taskQueue: "q" }],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid waitBudgetsMs override", () => {
    const result = validateConfig({
      project: "p",
      workerEntryPoint: "./w.ts",
      taskQueues: ["q"],
      workflows: [{ type: "T", taskQueue: "q" }],
      waitBudgetsMs: { A1: { waitTimeoutMs: 12000 }, F2: { childStartTimeoutMs: 9000 } },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a non-numeric wait budget value", () => {
    const result = validateConfig({
      project: "p",
      workerEntryPoint: "./w.ts",
      taskQueues: ["q"],
      workflows: [{ type: "T", taskQueue: "q" }],
      waitBudgetsMs: { A1: { waitTimeoutMs: "fast" } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("waitBudgetsMs.A1.waitTimeoutMs must be a positive number");
  });

  it("rejects a negative or zero wait budget value", () => {
    const result = validateConfig({
      project: "p",
      workerEntryPoint: "./w.ts",
      taskQueues: ["q"],
      workflows: [{ type: "T", taskQueue: "q" }],
      waitBudgetsMs: { B5: { gracePeriodMs: 0 } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("waitBudgetsMs.B5.gracePeriodMs must be a positive number");
  });

  it("rejects an unknown check ID under waitBudgetsMs", () => {
    const result = validateConfig({
      project: "p",
      workerEntryPoint: "./w.ts",
      taskQueues: ["q"],
      workflows: [{ type: "T", taskQueue: "q" }],
      waitBudgetsMs: { Z9: { somethingMs: 100 } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("waitBudgetsMs.Z9 is not a recognized check ID with a configurable wait budget");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run src/config/schema.test.ts`
Expected: FAIL — `waitBudgetsMs` doesn't exist on the type / `validateConfig`
doesn't reject anything under it yet.

- [ ] **Step 3: Add `WaitBudgetsConfig` and wire validation in `schema.ts`**

Add after `FeaturesConfig` (before `TestKitConfig`):

```ts
/**
 * Optional per-check overrides for the internal "how long do we wait before
 * giving up" budgets each dynamic check uses. Every field's default is that
 * check's own hardcoded value (see the check file itself) — leaving this
 * whole block, or any individual check/field within it, unset produces
 * IDENTICAL behavior to before this existed. Deliberately per-check rather
 * than a shared/global timeout: same-valued constants across unrelated
 * checks are coincidence, not a shared meaning, so raising one must never
 * silently raise another.
 */
export interface WaitBudgetsConfig {
  A1?: { waitTimeoutMs?: number };
  A4?: { waitTimeoutMs?: number };
  B3?: { resultWaitMs?: number };
  B4?: { runTimeoutMs?: number };
  B5?: { gracePeriodMs?: number };
  C1?: { queryWaitMs?: number };
  C2?: { queryTimeoutMs?: number };
  C3?: { queryTimeoutMs?: number };
  C5?: { responseWaitMs?: number };
  D1?: { resultWaitMs?: number };
  E1?: { resultWaitMs?: number };
  E2?: { queryWaitMs?: number; resultWaitMs?: number };
  F1?: { discoveryTimeoutMs?: number; resultWaitMs?: number };
  F2?: { childStartTimeoutMs?: number; policySettleTimeoutMs?: number };
  G1?: { resultWaitMs?: number };
  H1?: { resultWaitMs?: number };
  H2?: { graceMs?: number };
  H3?: { childStartTimeoutMs?: number; resultWaitMs?: number };
  I1?: { markerWaitTimeoutMs?: number; resultWaitMs?: number };
  I3?: { runTimeoutMs?: number };
  I4?: { correctQueueWaitMs?: number };
  I5?: { resultWaitMs?: number };
  J1?: { waitTimeoutMs?: number };
  J2?: { describeWaitMs?: number };
  J3?: { waitTimeoutMs?: number };
  K2?: { resultWaitMs?: number };
  L1?: { resultWaitMs?: number };
  L2?: { resultWaitMs?: number };
}
```

Add `waitBudgetsMs?: WaitBudgetsConfig;` to `TestKitConfig`.

Add a validation function and wire it into `validateConfig`:

```ts
function validateWaitBudgets(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push("waitBudgetsMs must be an object");
    return;
  }
  const knownKeys: Record<string, string[]> = {
    A1: ["waitTimeoutMs"],
    A4: ["waitTimeoutMs"],
    B3: ["resultWaitMs"],
    B4: ["runTimeoutMs"],
    B5: ["gracePeriodMs"],
    C1: ["queryWaitMs"],
    C2: ["queryTimeoutMs"],
    C3: ["queryTimeoutMs"],
    C5: ["responseWaitMs"],
    D1: ["resultWaitMs"],
    E1: ["resultWaitMs"],
    E2: ["queryWaitMs", "resultWaitMs"],
    F1: ["discoveryTimeoutMs", "resultWaitMs"],
    F2: ["childStartTimeoutMs", "policySettleTimeoutMs"],
    G1: ["resultWaitMs"],
    H1: ["resultWaitMs"],
    H2: ["graceMs"],
    H3: ["childStartTimeoutMs", "resultWaitMs"],
    I1: ["markerWaitTimeoutMs", "resultWaitMs"],
    I3: ["runTimeoutMs"],
    I4: ["correctQueueWaitMs"],
    I5: ["resultWaitMs"],
    J1: ["waitTimeoutMs"],
    J2: ["describeWaitMs"],
    J3: ["waitTimeoutMs"],
    K2: ["resultWaitMs"],
    L1: ["resultWaitMs"],
    L2: ["resultWaitMs"],
  };
  for (const [checkId, entry] of Object.entries(value)) {
    if (!(checkId in knownKeys)) {
      errors.push(`waitBudgetsMs.${checkId} is not a recognized check ID with a configurable wait budget`);
      continue;
    }
    if (!isPlainObject(entry)) {
      errors.push(`waitBudgetsMs.${checkId} must be an object`);
      continue;
    }
    for (const [field, fieldValue] of Object.entries(entry)) {
      if (!knownKeys[checkId].includes(field)) {
        errors.push(`waitBudgetsMs.${checkId}.${field} is not a recognized wait-budget field for ${checkId}`);
        continue;
      }
      if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue) || fieldValue <= 0) {
        errors.push(`waitBudgetsMs.${checkId}.${field} must be a positive number`);
      }
    }
  }
}
```

In `validateConfig`, add:

```ts
if ("waitBudgetsMs" in obj) {
  validateWaitBudgets(obj.waitBudgetsMs, errors);
}
```

- [ ] **Step 4: Run the schema test again, confirm it passes**

Run: `npx vitest run src/config/schema.test.ts`
Expected: PASS (all 5 new tests, plus every pre-existing test in that file
unchanged).

- [x] **Step 5: Update `DynamicFixtureCheckFn` in `fixture-check.ts`** (DONE,
  with the append-after-`signal` correction from the note above — NOT the
  order originally drafted):

```ts
import { WorkflowConfig, FeaturesConfig, WaitBudgetsConfig } from "../../config/schema.js";
// ...
export type DynamicFixtureCheckFn = (
  env: EphemeralEnvironment,
  target: DynamicFixtureTarget,
  features: FeaturesConfig,
  signal?: AbortSignal,
  waitBudgets?: WaitBudgetsConfig,
) => Promise<TestResult>;
```

- [x] **Step 6: Update `ZeroFixtureCheckFn` and both orchestration loops in `cli.ts`** (DONE, same correction):

```ts
type ZeroFixtureCheckFn = (
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
  waitBudgets?: WaitBudgetsConfig,
) => Promise<TestResult>;
```

`zeroFixtureDynamicResults`'s call site:

```ts
fn(
  env,
  { workflowType: workflow.type, taskQueue: workflow.taskQueue, workflowsPath, activities },
  signal,
  config.waitBudgetsMs,
),
```

`dynamicFixtureResults`'s call site:

```ts
fn(env, { ...workflow, workflowsPath, activities }, features, signal, config.waitBudgetsMs),
```

`WaitBudgetsConfig` added to the existing `import { ... } from "./config/schema.js"` in `cli.ts`.

Verified via `tsc --noEmit` immediately after this step: 0 errors — every
existing check function (touched or not) is still structurally valid,
because the new param is a genuinely new trailing optional slot, not an
inserted one.

- [ ] **Step 7: Confirm the project still typechecks**

Run: `npx tsc --noEmit`
Expected: New errors ONLY in the 28 check files whose exported functions no
longer structurally match the (now 4- and 5-param) `ZeroFixtureCheckFn`/
`DynamicFixtureCheckFn` types — this is expected and is exactly what Tasks 1
and 2 fix. Confirm no OTHER unrelated errors appear (e.g. in `a3.ts`, `k1.ts`,
`c4.ts`, `d2.ts`/`d3.ts`/`d4.ts`, which stay untouched and must still
typecheck cleanly since a function declaring fewer params than the type
requires stays structurally assignable).

- [ ] **Step 8: Commit**

```bash
git add src/config/schema.ts src/config/schema.test.ts src/engines/dynamic/fixture-check.ts src/cli.ts
git commit -m "$(cat <<'EOF'
Add waitBudgetsMs config schema and thread it through both check orchestration loops

Lays the shared plumbing (type, validation, cli.ts call sites) for making
per-check internal wait budgets configurable, before touching any individual
check file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Mechanical codemod for the 26 "simple" files

**Files:**
- Create (scratch, not committed): `/tmp/claude-1000/-home-technoidentity-com-Documents-temporal-testing-temporal-test-kit/724b0bef-0d2b-4875-86f1-b31a7d55223c/scratchpad/apply-wait-budgets.mjs`
- Modify: all 26 files from the table above EXCEPT `b4.ts` and `h2.ts`
  (`a1.ts`, `a4.ts`, `b3.ts`, `b5.ts`, `c1.ts`, `c2.ts`, `c3.ts`, `c5.ts`,
  `d1.ts`, `e1.ts`, `e2.ts`, `f1.ts`, `f2.ts`, `g1.ts`, `h1.ts`, `h3.ts`,
  `i1.ts`, `i3.ts`, `i4.ts`, `i5.ts`, `j1.ts`, `j2.ts`, `j3.ts`, `k2.ts`,
  `l1.ts`, `l2.ts`)

**Interfaces:**
- Consumes: `WaitBudgetsConfig` from Task 0.
- Produces: each file's exported check function gains a `waitBudgets`
  parameter (positioned per the table below) and, as its first statement (or
  first statement inside its `withRunningWorker`/`return` body, whichever is
  the actual top of the function), one `const <camelKey> = waitBudgets?.<ID>?.<camelKey> ?? <ORIGINAL_CONSTANT>;`
  line per key, with all subsequent USES of `<ORIGINAL_CONSTANT>` inside that
  function body (not in the module-level doc comment above it) replaced by
  `<camelKey>`.

The script is a plain Node script over the filesystem — no new dependency,
no AST library. It operates file-by-file using exactly the per-file data
already in the table above (encoded as a literal array in the script, not
inferred), so there is no ambiguity for it to get wrong beyond "did I type
the table correctly," which Step 2's line-by-line diff review below catches.

- [ ] **Step 1: Write the script**

```js
// apply-wait-budgets.mjs — one-time mechanical transform, not committed.
import { readFileSync, writeFileSync } from "node:fs";

const CHECKS_DIR = "/home/technoidentity-com/Documents/temporal_testing/temporal-test-kit/src/engines/dynamic/checks";

// One entry per "simple" file. `constants`: [MODULE_CONSTANT_NAME, camelKey].
// `signalParam`: the exact existing last-parameter text; `waitBudgets` is
// appended AFTER it (never before — see the Global Constraints note on the
// contextual-typing hazard this avoids). `noSignal`/`arrowNoSignal`: the file
// has no existing signal param, so an explicit `_signal?: AbortSignal,`
// placeholder is added FIRST to hold that position, with `waitBudgets` after
// it — skipping straight to `waitBudgets` would silently bind it to whatever
// value is actually passed in the signal call position instead.
const FILES = [
  { file: "a1.ts", id: "A1", constants: [["WAIT_TIMEOUT_MS", "waitTimeoutMs"]], signalParam: "signal?: AbortSignal," },
  { file: "a4.ts", id: "A4", constants: [["WAIT_TIMEOUT_MS", "waitTimeoutMs"]], signalParam: "signal?: AbortSignal," },
  { file: "b3.ts", id: "B3", constants: [["RESULT_WAIT_MS", "resultWaitMs"]], arrow: true },
  { file: "b5.ts", id: "B5", constants: [["GRACE_PERIOD_MS", "gracePeriodMs"]], signalParam: "signal?: AbortSignal," },
  { file: "c1.ts", id: "C1", constants: [["QUERY_WAIT_MS", "queryWaitMs"]], arrow: true },
  { file: "c2.ts", id: "C2", constants: [["QUERY_TIMEOUT_MS", "queryTimeoutMs"]], arrow: true },
  { file: "c3.ts", id: "C3", constants: [["QUERY_TIMEOUT_MS", "queryTimeoutMs"]], arrow: true },
  { file: "c5.ts", id: "C5", constants: [["RESPONSE_WAIT_MS", "responseWaitMs"]], arrow: true },
  { file: "d1.ts", id: "D1", constants: [["RESULT_WAIT_MS", "resultWaitMs"]], noSignal: true },
  { file: "e1.ts", id: "E1", constants: [["RESULT_WAIT_MS", "resultWaitMs"]], signalParam: "signal?: AbortSignal," },
  { file: "e2.ts", id: "E2", constants: [["QUERY_WAIT_MS", "queryWaitMs"], ["RESULT_WAIT_MS", "resultWaitMs"]], arrow: true, arrowSignalName: "abortSignal" },
  { file: "f1.ts", id: "F1", constants: [["DISCOVERY_TIMEOUT_MS", "discoveryTimeoutMs"], ["RESULT_WAIT_MS", "resultWaitMs"]], arrow: true },
  { file: "f2.ts", id: "F2", constants: [["CHILD_START_TIMEOUT_MS", "childStartTimeoutMs"], ["POLICY_SETTLE_TIMEOUT_MS", "policySettleTimeoutMs"]], arrow: true },
  { file: "g1.ts", id: "G1", constants: [["RESULT_WAIT_MS", "resultWaitMs"]], arrow: true },
  { file: "h1.ts", id: "H1", constants: [["RESULT_WAIT_MS", "resultWaitMs"]], arrow: true },
  { file: "h3.ts", id: "H3", constants: [["CHILD_START_TIMEOUT_MS", "childStartTimeoutMs"], ["RESULT_WAIT_MS", "resultWaitMs"]], arrow: true },
  { file: "i1.ts", id: "I1", constants: [["MARKER_WAIT_TIMEOUT_MS", "markerWaitTimeoutMs"], ["RESULT_WAIT_MS", "resultWaitMs"]], noSignal: true },
  { file: "i3.ts", id: "I3", constants: [["RUN_TIMEOUT_MS", "runTimeoutMs"]], signalParam: "signal?: AbortSignal," },
  { file: "i4.ts", id: "I4", constants: [["CORRECT_QUEUE_WAIT_MS", "correctQueueWaitMs"]], signalParam: "signal?: AbortSignal," },
  { file: "i5.ts", id: "I5", constants: [["RESULT_WAIT_MS", "resultWaitMs"]], noSignal: true },
  { file: "j1.ts", id: "J1", constants: [["WAIT_TIMEOUT_MS", "waitTimeoutMs"]], signalParam: "signal?: AbortSignal," },
  { file: "j2.ts", id: "J2", constants: [["DESCRIBE_WAIT_MS", "describeWaitMs"]], arrow: true, arrowNoSignal: true },
  { file: "j3.ts", id: "J3", constants: [["WAIT_TIMEOUT_MS", "waitTimeoutMs"]], signalParam: "signal?: AbortSignal," },
  { file: "k2.ts", id: "K2", constants: [["RESULT_WAIT_MS", "resultWaitMs"]], arrow: true },
  { file: "l1.ts", id: "L1", constants: [["RESULT_WAIT_MS", "resultWaitMs"]], noSignal: true },
  { file: "l2.ts", id: "L2", constants: [["RESULT_WAIT_MS", "resultWaitMs"]], arrow: true },
];

for (const spec of FILES) {
  const path = `${CHECKS_DIR}/${spec.file}`;
  let src = readFileSync(path, "utf8");
  const originalSrc = src;

  // 1. Update the function signature to accept `waitBudgets`, appended
  //    AFTER any existing signal param (never before it).
  if (spec.arrow) {
    // Arrow functions: `async (env, target, _features|features, [abortSignal|signal])? => {`
    const paramsRe = /(async \(env, target, _?features)(, (?:abortSignal|signal))?(\) => \{)/;
    const m = src.match(paramsRe);
    if (!m) throw new Error(`${spec.file}: arrow signature not found`);
    const replacement = spec.arrowNoSignal
      ? `${m[1]}, _signal, waitBudgets${m[3]}`
      : `${m[1]}${m[2]}, waitBudgets${m[3]}`;
    src = src.replace(paramsRe, replacement);
  } else if (spec.noSignal) {
    // No existing signal param: add an explicit `_signal` placeholder to
    // hold that position, THEN `waitBudgets` after it, right before the
    // closing `): Promise<TestResult> {`.
    src = src.replace(
      /(\n\): Promise<TestResult> \{)/,
      `\n  _signal?: AbortSignal,\n  waitBudgets?: WaitBudgetsConfig,$1`,
    );
  } else {
    // Existing `signal?: AbortSignal,` line: append waitBudgets right after it.
    src = src.replace(
      spec.signalParam,
      `${spec.signalParam}\n  waitBudgets?: WaitBudgetsConfig,`,
    );
  }

  // 2. Add the WaitBudgetsConfig import if not already present.
  if (!src.includes("WaitBudgetsConfig")) {
    // Every check file already imports something from "../../../config/schema.js"
    // or has its own relative path; find the nearest existing config schema
    // import and extend it, otherwise add a new import line after the last
    // top-of-file import.
    const schemaImportRe = /import \{([^}]*)\} from "([^"]*config\/schema\.js)";/;
    if (schemaImportRe.test(src)) {
      src = src.replace(schemaImportRe, (_, names, p) => `import {${names}, WaitBudgetsConfig} from "${p}";`);
    } else {
      const lastImportMatch = [...src.matchAll(/^import .*;$/gm)].pop();
      const insertAt = lastImportMatch.index + lastImportMatch[0].length;
      src = src.slice(0, insertAt) + `\nimport { WaitBudgetsConfig } from "../../../config/schema.js";` + src.slice(insertAt);
    }
  }

  // 3. Insert the resolution line(s) and substitute usages, one constant at a time.
  for (const [constName, camelKey] of spec.constants) {
    const resolutionLine = `const ${camelKey} = waitBudgets?.${spec.id}?.${camelKey} ?? ${constName};\n`;

    // Find the function body's opening brace (arrow's `=> {` or the
    // declaration's `): Promise<TestResult> {`), insert the resolution line
    // as the first statement of the body. `waitBudgets` is always the last
    // param now, so for arrows it's always immediately before `) => {`.
    const bodyOpenRe = spec.arrow
      ? /(waitBudgets\) => \{\n)/
      : /(\): Promise<TestResult> \{\n)/;
    const bodyMatch = src.match(bodyOpenRe);
    if (!bodyMatch) throw new Error(`${spec.file}: body open not found for ${constName}`);
    const insertPos = bodyMatch.index + bodyMatch[0].length;
    src = src.slice(0, insertPos) + `  ${resolutionLine}` + src.slice(insertPos);

    // Replace usages of the bare constant AFTER the inserted line (so the
    // resolution line's own right-hand-side reference to constName survives
    // untouched), but not inside "/** ... */" doc comments — restrict to
    // lines that contain actual code tokens for this constant, i.e. skip
    // lines starting with optional whitespace then `*` or `//`.
    const afterInsert = insertPos + resolutionLine.length + 2;
    const head = src.slice(0, afterInsert);
    const tail = src.slice(afterInsert);
    const tailReplaced = tail
      .split("\n")
      .map((line) => {
        if (/^\s*(\*|\/\/)/.test(line)) return line; // leave comments referencing the constant untouched
        return line.replaceAll(constName, camelKey);
      })
      .join("\n");
    src = head + tailReplaced;
  }

  if (src === originalSrc) throw new Error(`${spec.file}: no changes applied — check the patterns above`);
  writeFileSync(path, src, "utf8");
  console.log(`patched ${spec.file}`);
}
```

- [ ] **Step 2: Run it**

Run: `node /tmp/claude-1000/-home-technoidentity-com-Documents-temporal-testing-temporal-test-kit/724b0bef-0d2b-4875-86f1-b31a7d55223c/scratchpad/apply-wait-budgets.mjs`
Expected: 26 lines of `patched <file>.ts`, no thrown errors. If any file
throws (a pattern didn't match — e.g. a signature that's formatted slightly
differently than assumed), STOP, inspect that one file by hand, fix the
script's pattern for that file's specific shape, and re-run from a clean git
state (`git checkout -- src/engines/dynamic/checks/<file>.ts` for any files
already patched in this attempt, since the script isn't idempotent) rather
than patching the already-modified output a second time.

- [ ] **Step 3: Review every diff by hand**

Run: `git diff --stat src/engines/dynamic/checks/`
Then: `git diff src/engines/dynamic/checks/` and read every hunk. Confirm for
each of the 26 files:
- The new `waitBudgets` parameter is always the LAST parameter, AFTER any
  existing `signal`/`abortSignal` — never before it. For the 5 no-signal
  files, an explicit `_signal?: AbortSignal,` placeholder was added first to
  hold that position correctly.
- Exactly one resolution line per key, placed as the first statement of the
  function body.
- Every usage of the original constant WITHIN the function body was
  replaced — cross-check against the earlier `grep -n` output captured
  during planning (e.g. `b5.ts` should show `GRACE_PERIOD_MS` replaced in
  all 4 of its usage sites, `f2.ts` in all of `CHILD_START_TIMEOUT_MS`'s 3
  and `POLICY_SETTLE_TIMEOUT_MS`'s 2).
- Doc comments referencing the constant by name (e.g. a1.ts's `* WAIT_TIMEOUT_MS for it to reach a terminal state`) were left alone — they still correctly describe the DEFAULT.
- The module-level `const ORIGINAL_CONSTANT = <value>;` declaration itself is
  untouched (still the literal default).

- [ ] **Step 4: `tsc --noEmit`, expect only `b4.ts`/`h2.ts` (and their tests) to still error**

Run: `npx tsc --noEmit`
Expected: zero errors. If any of the 26 files still errors, the script's
signature-insertion regex missed a call site elsewhere in that file (e.g. a
test file importing the function with the old arg count) — fix by hand, not
by re-running the script.

Note: `b4.ts`/`h2.ts` should NOT error yet if Task 0's type change only
requires check functions to be structurally assignable with fewer params —
confirm this is actually true by running `tsc` now, before Task 2 touches
them; if it turns out `b4.ts`/`h2.ts` DO error here, that's useful
information for Task 2, not a problem with this task.

- [ ] **Step 5: Commit**

```bash
git add src/engines/dynamic/checks/
git commit -m "$(cat <<'EOF'
Thread waitBudgetsMs overrides into the 26 checks with a single top-level wait constant

Mechanical, scripted change (not hand-edited per file) — every check keeps
its existing hardcoded value as the default and only reads an override for
its own catalog ID. b4.ts and h2.ts are handled separately since their wait
constants are consumed by an internal helper function, not the check itself.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: The two helper-threaded exceptions

### Task 2a: `h2.ts`

**Files:**
- Modify: `src/engines/dynamic/checks/h2.ts`

- [ ] **Step 1**: Add `WaitBudgetsConfig` to `h2.ts`'s imports from
  `../../../config/schema.js` (or add a new import line if none exists yet).
- [ ] **Step 2**: Add `waitBudgets?: WaitBudgetsConfig,` as the new 4th
  parameter to `checkH2TerminateSkipsCleanup`, AFTER `signal?: AbortSignal,`
  (never before — see the Global Constraints note on why appending after any
  existing `signal` param is required everywhere in this plan).
- [ ] **Step 3**: Change the call site inside `checkH2TerminateSkipsCleanup`
  from:
  ```ts
  const outcome = await terminateAndAwaitTerminated(handle, "temporal-test-kit H2 check: verifying terminate() takes effect");
  ```
  to:
  ```ts
  const graceMs = waitBudgets?.H2?.graceMs ?? DEFAULT_GRACE_MS;
  const outcome = await terminateAndAwaitTerminated(handle, "temporal-test-kit H2 check: verifying terminate() takes effect", graceMs);
  ```
  Leave `terminateAndAwaitTerminated`'s own signature/default param
  UNCHANGED — its doc comment explicitly says it's exported standalone so
  tests can drive it directly with a custom `graceMs`, which stays true and
  useful independent of this change.
- [ ] **Step 4**: `npx tsc --noEmit`, confirm `h2.ts` no longer errors and no
  new errors appear.
- [ ] **Step 5**: Run `npx vitest run src/engines/dynamic/checks/h2.test.ts`,
  confirm every existing test still passes unmodified.
- [ ] **Step 6**: Commit (can be combined with Task 2b's commit).

### Task 2b: `b4.ts`

**Files:**
- Modify: `src/engines/dynamic/checks/b4.ts`
- Modify: `src/engines/dynamic/checks/b4.test.ts` (only if its direct call to
  `recordActivityExecutions` needs updating to still compile — it currently
  calls it with 3 args; adding a new 4th optional param before `signal`
  means the test's existing 3-arg call becomes ambiguous if `signal` is
  actually its 3rd arg today. Check exact test call shape first.)

- [x] **Step 1** (already confirmed during planning): `b4.test.ts:53` calls
  `recordActivityExecutions(env, { ...target })` with only 2 args — no
  existing 3rd argument, so a new trailing param is safe there regardless of
  exact position. `recordActivityExecutions` isn't assigned to either shared
  `CheckFn` type (it's its own standalone exported function, called directly
  by both `checkB4Heartbeats` and this test), so it has no contextual-typing
  hazard — but for consistency with every other file in this plan, its new
  param is still appended AFTER the existing `signal` param, not before.
- [ ] **Step 2**: Add `WaitBudgetsConfig` to `b4.ts`'s imports.
- [ ] **Step 3**: Add a `runTimeoutMs: number = RUN_TIMEOUT_MS` parameter to
  `recordActivityExecutions`'s existing signature, AFTER its existing
  `signal?: AbortSignal` param, mirroring `terminateAndAwaitTerminated`'s own
  default-param pattern in `h2.ts` — this keeps `recordActivityExecutions`
  directly testable with a custom value, same reasoning as `h2.ts`.
- [ ] **Step 4**: Inside `recordActivityExecutions`, replace the
  `RUN_TIMEOUT_MS` usage at (originally) line 209 with `runTimeoutMs`. Leave
  `POLL_INTERVAL_MS` untouched (out of scope, confirmed earlier).
- [ ] **Step 5**: Add `waitBudgets?: WaitBudgetsConfig,` as the new 4th
  parameter to `checkB4Heartbeats`, AFTER `signal?: AbortSignal,`.
- [ ] **Step 6**: Change `checkB4Heartbeats`'s call site from
  `recordActivityExecutions(env, target, signal)` to:
  ```ts
  recorded = await recordActivityExecutions(env, target, signal, waitBudgets?.B4?.runTimeoutMs ?? RUN_TIMEOUT_MS);
  ```
- [ ] **Step 7**: `npx tsc --noEmit`, confirm zero errors project-wide.
- [ ] **Step 8**: Run `npx vitest run src/engines/dynamic/checks/b4.test.ts`,
  confirm every existing test still passes unmodified (this is the file most
  likely to need a real fix, not just a mechanical one, given
  `recordActivityExecutions` is called directly from the test with a fixed
  argument count today).
- [ ] **Step 9**: Commit

```bash
git add src/engines/dynamic/checks/h2.ts src/engines/dynamic/checks/b4.ts src/engines/dynamic/checks/b4.test.ts
git commit -m "$(cat <<'EOF'
Thread waitBudgetsMs into b4/h2's internal helper functions

These two checks' wait constants are consumed by a separate exported helper
(recordActivityExecutions, terminateAndAwaitTerminated) rather than the
check function itself, so they need the override passed down as an explicit
argument instead of the simple local-variable pattern used everywhere else.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Baseline regression run — BEFORE writing any new tests

**This task has no code changes.** Its only purpose is producing the
before/after evidence Q2 asked for.

- [ ] **Step 1**: Before Task 0 begins (do this FIRST, ahead of everything
  above — reorder if executing sequentially), run the full suite once and
  save its output:
  ```bash
  npx vitest run 2>&1 | tee /tmp/claude-1000/-home-technoidentity-com-Documents-temporal-testing-temporal-test-kit/724b0bef-0d2b-4875-86f1-b31a7d55223c/scratchpad/baseline-run.txt
  ```
  Record the total pass/fail/skip counts.

- [ ] **Step 2**: After Tasks 0-2 are complete (all 28 files changed, zero
  new tests added yet), run the full suite again with every existing test
  file completely unmodified:
  ```bash
  npx vitest run 2>&1 | tee /tmp/claude-1000/-home-technoidentity-com-Documents-temporal-testing-temporal-test-kit/724b0bef-0d2b-4875-86f1-b31a7d55223c/scratchpad/after-run.txt
  ```

- [ ] **Step 3**: Diff the two pass/fail sets:
  ```bash
  diff <(grep -E "✓|✗|×" /tmp/claude-1000/-home-technoidentity-com-Documents-temporal-testing-temporal-test-kit/724b0bef-0d2b-4875-86f1-b31a7d55223c/scratchpad/baseline-run.txt) \
       <(grep -E "✓|✗|×" /tmp/claude-1000/-home-technoidentity-com-Documents-temporal-testing-temporal-test-kit/724b0bef-0d2b-4875-86f1-b31a7d55223c/scratchpad/after-run.txt)
  ```
  Expected: NO diff output (identical pass/fail set). This is the actual
  proof that the default-path behavior is unchanged — not an assumption, not
  "the override test passed so the default must be fine too." If anything
  differs, stop and root-cause it (per `systematic-debugging`) before
  proceeding to Task 4 — do not paper over a regression by adjusting an
  existing test's expectation.

---

## Task 4: One override-honored test per check (28 new tests)

**Files:** each check's own existing `*.test.ts` file (28 files) gets one
new `it(...)` block added — no existing test in these files is modified.

**Pattern** (fully worked example for `a1.ts`; every other file substitutes
its own catalog ID, key name, and default value from the table in the
"Full audit" section above — nothing here is a placeholder, every value
needed is already fully specified there):

```ts
it("honors a waitBudgetsMs.A1.waitTimeoutMs override instead of the hardcoded default", async () => {
  // A workflow type that will never actually start (no worker for it) means
  // the check's internal wait is guaranteed to run out — this proves WHICH
  // wait value was actually used, by how long the check takes / what timeout
  // value appears in its own FAIL message.
  const start = Date.now();
  const result = await checkA1WorkflowStarts(
    env,
    { workflowType: "NeverStarts", taskQueue: "no-such-queue", workflowsPath, activities },
    { A1: { waitTimeoutMs: 500 } },
  );
  const elapsedMs = Date.now() - start;
  expect(elapsedMs).toBeLessThan(5000); // well under the DEFAULT 8000ms — proves the override, not the default, was used
  expect(result.message).toContain("500ms");
});
```

The exact assertion shape (timing-based vs. message-content-based vs. both)
should follow whatever each file's EXISTING tests already use to observe
that check's timeout behavior — do not invent a new assertion style per
file; grep each file's own `*.test.ts` for how it already asserts on
`WAIT_TIMEOUT_MS`/`RESULT_WAIT_MS`/etc.-driven behavior (most already have at
least one test that exercises the "still RUNNING after waiting Nms" FAIL
path) and adapt that same pattern with a small override value instead of
writing a fresh assertion approach.

- [ ] **Step 1**: For each of the 28 files, write the one new override test
  following the file's own existing test conventions.
- [ ] **Step 2**: Run each new test individually as it's written:
  `npx vitest run src/engines/dynamic/checks/<file>.test.ts`
- [ ] **Step 3**: Once all 28 are added, run the full suite (`npx vitest
  run`) and confirm: every pre-existing test still passes (same set as
  Task 3's "after" run), plus all 28 new tests pass.
- [ ] **Step 4**: Commit

```bash
git add src/engines/dynamic/checks/*.test.ts
git commit -m "$(cat <<'EOF'
Add one override-honored test per check for waitBudgetsMs

Proves each check actually reads its own config slice, on top of Task 3's
separate baseline diff already proving the default (no-config) path is
unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Discoverability — `init` template + README

**Files:**
- Modify: `src/config/init-template.ts`
- Modify: `src/config/init-template.test.ts`
- Modify: `README.md` (Configuration section)

- [ ] **Step 1: Write the failing template test**

Add to `init-template.test.ts`:

```ts
it("mentions waitBudgetsMs so a new project can discover the override exists", () => {
  expect(parsed).toHaveProperty("waitBudgetsMs");
  const idx = template.indexOf('"waitBudgetsMs"');
  expect(idx).toBeGreaterThan(-1);
  const context = template.slice(Math.max(0, idx - 600), idx);
  expect(context).toMatch(/wait budget|timeout|README/i);
});
```

- [ ] **Step 2**: Run `npx vitest run src/config/init-template.test.ts`,
  confirm it fails (field doesn't exist yet).

- [ ] **Step 3**: Add to `generateInitTemplate()`'s template string, right
  before the `"outputDir"` line:

```
  // ---- OPTIONAL, advanced: override internal per-check wait budgets ----
  // Every dynamic check that waits on Temporal state (a workflow reaching a
  // terminal state, a query/result resolving, a child workflow starting,
  // etc.) has its own built-in default timeout, already tuned to run
  // comfortably in a normal CI environment. Leave this empty to keep every
  // check's default behavior completely unchanged — these are OVERRIDES,
  // not required configuration. See README's Configuration section for the
  // full list of check IDs, field names, and current default values.
  // Example: "waitBudgetsMs": { "A1": { "waitTimeoutMs": 12000 } }
  "waitBudgetsMs": {},

  "outputDir": "./temporal-test-kit-report"
```

- [ ] **Step 4**: Run `npx vitest run src/config/init-template.test.ts`,
  confirm it and every pre-existing test in that file passes.

- [ ] **Step 5**: Add a subsection to `README.md`'s "## Configuration"
  section, after the existing `features` block and before "### Avoiding
  common setup errors":

```markdown
### Overriding internal wait budgets (advanced)

Every dynamic check that waits on live Temporal state — a workflow reaching
a terminal state, a query or result resolving, a child workflow starting,
cancellation/termination taking effect — has its own built-in default
timeout, already tuned to run comfortably in a normal CI environment. These
are almost never something you need to touch. If a slow environment needs
more headroom for a *specific* check, override just that one under
`waitBudgetsMs`, keyed by check ID:

```jsonc
"waitBudgetsMs": {
  "A1": { "waitTimeoutMs": 12000 },
  "F2": { "childStartTimeoutMs": 9000 }
}
```

Leaving `waitBudgetsMs` empty or omitted entirely keeps every check's
default behavior exactly as-is. There is deliberately no single global
timeout knob — these values aren't a shared setting, they're independent
budgets that happen to reuse similar numbers today; raising one must never
silently raise an unrelated check's.

| Check | Field(s) | Default(s) |
|---|---|---|
| A1, A4, J1, J3 | `waitTimeoutMs` | A1/J1/J3: 8000, A4: 5000 |
| B3, D1, E1, G1, H1, I5, K2, L1, L2 | `resultWaitMs` | 10000 (E1: 15000) |
| B4 | `runTimeoutMs` | 10000 |
| B5 | `gracePeriodMs` | 5000 |
| C1 | `queryWaitMs` | 5000 |
| C2, C3 | `queryTimeoutMs` | 5000 |
| C5 | `responseWaitMs` | 8000 |
| E2 | `queryWaitMs`, `resultWaitMs` | 5000, 10000 |
| F1 | `discoveryTimeoutMs`, `resultWaitMs` | 6000, 10000 |
| F2 | `childStartTimeoutMs`, `policySettleTimeoutMs` | 6000, 8000 |
| H2 | `graceMs` | 5000 |
| H3 | `childStartTimeoutMs`, `resultWaitMs` | 6000, 10000 |
| I1 | `markerWaitTimeoutMs`, `resultWaitMs` | 10000, 25000 |
| I3 | `runTimeoutMs` | 10000 |
| I4 | `correctQueueWaitMs` | 5000 |
| J2 | `describeWaitMs` | 5000 |
```

- [ ] **Step 6**: Commit

```bash
git add src/config/init-template.ts src/config/init-template.test.ts README.md
git commit -m "$(cat <<'EOF'
Document waitBudgetsMs in the init template and README

A new project generated via 'init' had no way to discover this override
exists without reading the source — now it's shown (empty, non-default) in
the generated config, with the full field/default reference in the README.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: CLAUDE.md documentation note

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1**: Add a new section (after "Config schema scope", matching
  this file's existing pattern of documenting notable design decisions with
  their reasoning):

```markdown
## Configurable per-check wait budgets (`waitBudgetsMs`)

28 of the dynamic checks hardcode an internal "how long do we wait before
giving up" constant (terminal-state waits, query/result waits, cancellation
grace periods, child-workflow-start discovery, etc.) — a real pilot run hit
several of these on a slower environment. `src/config/schema.ts`'s
`WaitBudgetsConfig` makes each one independently overridable via
`temporal-test-kit.config.json`'s `waitBudgetsMs`, keyed by catalog ID, with
every field's default being that check's own pre-existing hardcoded value —
an empty/omitted `waitBudgetsMs` is behavior-identical to before this
existed.

Deliberately per-check, not global or category-grouped: several of these
constants share a numeric value today (e.g. several unrelated checks use
5000ms) purely by coincidence, not shared meaning — grouping them under one
knob would mean fixing one flaky check silently changes unrelated ones, with
no way to un-couple them later. Poll intervals, and `d2.ts`/`d3.ts`/`d4.ts`'s
Schedule-cadence-derived waits, are deliberately NOT included — see
`src/config/schema.ts`'s `WaitBudgetsConfig` doc comment and the plan at
`docs/superpowers/plans/2026-09-10-configurable-wait-budgets.md` for the
full reasoning and file-by-file list.

`b4.ts` and `h2.ts` are the two exceptions where the wait constant is
consumed by a separately-exported helper function
(`recordActivityExecutions`, `terminateAndAwaitTerminated`) rather than the
check itself — the override is resolved in the check function and passed
down as an explicit argument, while the helper's own default parameter stays
in place unchanged (both helpers are exported standalone specifically so
tests can drive them directly with a custom value).
```

- [ ] **Step 2**: Commit

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
CLAUDE.md: document the waitBudgetsMs design and why it's per-check

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification and push

- [ ] **Step 1**: `npx tsc --noEmit` — expect zero errors.
- [ ] **Step 2**: `npx vitest run` (full suite) — run TWICE (per the
  standard verification bar for this repo), expect identical pass counts
  both times, zero failures, and — per CLAUDE.md's known-issue notes — check
  for any orphaned `temporal-sdk-typescript` processes afterward via `ps aux`
  (expect none).
- [ ] **Step 3**: `npm run build` (or the project's actual build script —
  confirm exact name in `package.json`) to produce `dist/`.
- [ ] **Step 4**: Real audit run via `dist/cli.js` against
  `examples/sample-project`, with NO `waitBudgetsMs` in its config — confirm
  the report is unchanged from a pre-change run (compare check-by-check
  status, not just overall pass count).
- [ ] **Step 5**: Real audit run via `dist/cli.js` against
  `/home/technoidentity-com/Documents/temporal_testing/acceptance-check-project`,
  again with no `waitBudgetsMs` set, confirming unchanged behavior there too.
- [ ] **Step 6**: As an EXTRA confidence check (not strictly required by the
  original ask, but cheap given the audits are already running): re-run the
  `acceptance-check-project` audit once more WITH a `waitBudgetsMs` override
  added to its config for at least one check that a pilot run actually hit
  (e.g. raise J3 or F2's budget), and confirm the override is visibly
  reflected (either a different outcome, or the overridden value appearing
  in that check's own message).
- [ ] **Step 7**: Report the final commit hash(es) from this plan's task
  commits (per the standing memory on reporting commit hashes after
  verification).
- [ ] **Step 8**: Push to `https://github.com/NikhilRaju9010/temporal-test-kit.git`
  — confirm with the user first if the current branch isn't already the
  intended target, since this is a shared/remote-visible action.
