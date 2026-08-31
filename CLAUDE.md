# CLAUDE.md

Guidance for Claude Code (and future contributors/subagents) working in this repo.

## What this is

`temporal-test-kit` is a project-independent CLI that audits any Temporal
TypeScript project against 49 best-practice checks, without knowing anything
about that project's business logic. The full authoritative spec is
`001temporal-test-kit-build-spec-FINAL.md` (kept alongside this repo's origin
docs, not copied in here — see the build spec supplied to the session that
started this project). When in doubt about scope, behavior, or the config
schema, the spec wins over anything written here.

Build phases follow spec Section 9 strictly, in order — do not jump ahead
(e.g. don't build fixture-based checks before the zero-fixture ones are
solid). Each phase is committed separately with a message describing what it
added.

## The report statuses

Every check result carries exactly one status. They are never collapsed or
treated as equivalent — this honesty is the entire point of the tool. The
build spec defines five (PASS/FAIL/SKIPPED/N_A/NOT_COVERED); this codebase
adds one more (ERRORED) as a deliberate, documented deviation — see below.

- **PASS** — the check ran and found no problem.
- **FAIL** — the check ran and found a real problem *in the project under
  test*. Always carries a non-empty `hint` (why it matters + how to fix it).
- **SKIPPED** — the check needs fixture data from `temporal-test-kit.config.json`
  that wasn't provided. Always carries a non-empty `hint` naming exactly which
  config field would unlock it. Never shown as a pass.
- **N_A** — the check doesn't apply because this project doesn't use that
  Temporal feature at all (a `features.*` flag in config is false/unset).
  Distinct from SKIPPED: N_A means "doesn't apply here," not "missing info."
- **NOT_COVERED** — the check requires real infrastructure (multi-cluster,
  staging, load testing) that this local tool can never provide. Always
  appears in the report, never silently dropped.
- **ERRORED** — the check itself threw an unhandled exception, or didn't
  finish within its timeout. This is a bug/limit *in temporal-test-kit*, or an
  inconclusive run — never a finding about the project under test. Added in
  Phase 2b because conflating "the tool broke" with "the app broke" (i.e.
  reporting a tool crash as FAIL) would be exactly the kind of dishonest
  result the spec's five statuses exist to prevent, so treating it as a sixth
  distinct status is consistent with that principle even though the spec
  text itself only lists five. Always carries a non-empty `hint`.

`ResultCollector.add()` (`src/report/collect.ts`) enforces the
FAIL/SKIPPED/ERRORED hint requirement at runtime — it throws if you try to
add one of those with no hint. If you hit that error while writing a check,
you're missing a required field, not encountering a bug in the collector.

**Only the shared orchestrator produces ERRORED, never a check itself** — see
"Per-check timeout and error isolation" below. A check file should never
construct a `TestResult` with `status: "ERRORED"` by hand.

## File-per-test-ID convention

Every real (non-static, non-scaffolding) dynamic check lives in its own file
under `src/engines/dynamic/checks/`, named by its catalog ID in lowercase:
`i3.ts` for check I3, `a1.ts` for A1, etc. One file, one check, one exported
run function. This keeps each check reviewable and testable in isolation, and
is what makes parallelizing check implementation across subagents safe — they
never touch the same file.

`_fake.ts` in that same directory is a throwaway pipeline-proof check from
Phase 2a (not part of the 49-test catalog) — don't extend it, don't treat it
as a template for real checks; it exists only to exercise the reporters
end-to-end before real checks existed.

Static checks (`src/engines/static/checks.ts`) are currently grouped in one
file since there are only 5 of them (A2, B1, B2, B6, G2) and they're simple
code-scans; split them out per-ID only if that file grows unwieldy.

**Zero-fixture checks needing their own probe workflow** — several checks
(A1, B4, D1, E1, H2, I5, J3) can't reliably exercise the real target
project's workflow, either because it might complete too fast to observe an
interruption (H2, B5), might not use timers/continue-as-new/multiple tasks
at all (D1, E1, I5), or both. These build a small throwaway probe workflow
under `src/engines/dynamic/checks/fixtures/`, namespaced with the check's id
in lowercase (e.g. `d1-timer-workflow.ts`, `b5-hanging-workflow.ts`) so two
checks' fixtures can never collide. When a check uses its own probe instead
of `target.workflowType`, its `TestResult.target` should say so explicitly
(e.g. `"D1TimerWorkflow (internal probe)"`) and a code comment should explain
why — this is a deliberate, documented choice, not an oversight.

**Fixture workflow files must be copied into `dist/`, not just compiled** —
`npm run build` runs `tsc` then a `copy-fixtures` step
(`cp src/engines/dynamic/checks/fixtures/*.ts dist/.../fixtures/`). This
exists because Temporal's own worker bundler consumes a `workflowsPath`
pointing at TypeScript *source*, not `tsc`'s compiled `.js` output — the same
reason `i3.ts` points `workflowsPath` at a target project's raw `.ts` files
rather than anything this tool compiles. `tsc` only emits `.js`/`.d.ts` for
files under `src`; it does not copy the original `.ts` alongside them. Without
this step, every check with its own probe fixture works fine under `vitest`
(which resolves `.ts` straight from `src/`) but throws `ENOENT` the moment
you run the *built* CLI (`dist/cli.js`) — this actually happened during
Phase 2b integration and is why this step exists. If you add a new probe
fixture, no action needed — the copy step already globs the whole
`fixtures/` directory — but if you ever change the fixture path resolution
logic, re-verify against `dist/cli.js`, not just `vitest`, since that's the
one path individual unit/integration tests don't exercise.

## Where the master 49-test catalog lives

`src/catalog.ts` is the single source of truth for the full list of 49
tests — id, category, name, which engine runs it (`static` /
`dynamic-zero-fixture` / `dynamic-fixture` / `not-covered`), and which
`features.*` config flag (if any) gates it to N_A. It was transcribed from
the build spec's Section 6 and the "Temporal Complete Test Checklist" /
"Temporal 49-Test Execution Guide" reference docs. Any new check's `id`,
`category`, and `name` should come from this file, not be invented ad hoc —
if a check's catalog entry looks wrong, fix the spec/catalog mismatch instead
of silently diverging from it in the check's own file.

The engine assignment in `catalog.ts` is authoritative for which
directory a check's implementation belongs in
(`src/engines/static/`, `src/engines/dynamic/checks/`, or "not build,
report as NOT_COVERED").

### Checks not yet built: I1 and L1

Of the spec's 16 zero-fixture dynamic checks, 14 are built (`src/cli.ts`'s
`ZERO_FIXTURE_CHECKS` registry). **I1 (worker crash recovery)** and **L1
(Temporal Server outage recovery)** are deliberately not built yet — both
were investigated and found to need real infrastructure control this tool's
current architecture doesn't have, and building a fake version would have
silently under-tested exactly what their names promise:

- **I1** needs a worker to die *ungracefully* mid-task (no drain, no
  `shutdown()`, task token abandoned). Confirmed empirically: an in-process
  `Worker` cannot be forced into this state — the SDK blocks closing its
  connection out from under it (`IllegalStateError`, the same guard behind
  the "Worker lifecycle gotcha" above), and nothing short of killing the OS
  process stops its poll loop. A genuinely spawned-and-`SIGKILL`ed child
  process, connected to the ephemeral environment via its public `env.address`,
  was confirmed to work and produce the real recovery path (activity timeout
  → reschedule → single successful retry). I1 needs its own child-process
  worker-boot path, separate from `withRunningWorker` — don't try to bend
  `withRunningWorker` to support this; its whole contract is graceful
  shutdown-then-release, which is the opposite of what I1 needs to simulate.
- **L1** needs the actual Temporal *server* process to go down and come back.
  `TestWorkflowEnvironment` exposes no pause/resume for its embedded
  server — only permanent `teardown()` — and the underlying native binding
  (`@temporalio/core-bridge`) has no such capability at all to reach for
  either. A same-shared-`env` connection-loss proxy (close/reopen just the
  worker's `NativeConnection`) is buildable and safe, but only proves the SDK
  reconnects a dropped gRPC connection — a materially narrower claim than
  "survives the server actually being down," since the real server and every
  *other* check sharing `env` stay completely unaffected throughout. A
  faithful L1 needs its own private, disposable `TestWorkflowEnvironment`
  (created and torn down entirely inside the check, per the "Zero-fixture
  checks needing their own probe workflow" pattern below, but for the whole
  environment rather than just a workflow) so killing its server can't affect
  the other 13+ checks sharing the main one.

Both write-ups are preserved in this project's history for whoever builds
them — the short version is: neither is a code problem, both are an
architecture decision (child-process worker boot for I1; a disposable
private environment for L1) that should be made deliberately, not
discovered by a confusing test failure.

## Config schema scope

The config type in `src/config/schema.ts` is intentionally minimal as of
Phase 2a — only the fields needed by preflight and the zero-fixture dynamic
engine (`project`, `workerEntryPoint`, `taskQueues`, `workflows[].type`,
`workflows[].taskQueue`). The full fixture schema from the spec's Appendix A
(signals, updates, sensitiveDataFields, `features`, etc.) is Phase 3 scope —
don't add those fields to the schema early; extend it when Phase 3 actually
starts consuming them.

## Worker lifecycle gotcha — always boot workers through `bootWorker`

`Worker.create()` does **not** fully release its hold on the connection it
was created with. Creating a worker registers it as a reference holder on
the shared `NativeConnection` (`extractReferenceHolders(connection).add(...)`
inside `@temporalio/worker`), and that reference is only removed in the
`finally` block of `Worker.run()` — i.e. only once the worker has actually
run and shut down, not at `create()` time. If a check calls `Worker.create()`
and then leaves it there (or never runs it), `env.teardown()` throws
`IllegalStateError: Cannot close connection while Workers hold a reference to
it` — this was hit for real in Phase 2a's worker-boot preflight check.

`withRunningWorker` in `src/engines/dynamic/environment.ts` is the fix, and
the **default, expected call site of `Worker.create()`** — enforced by
convention, not the type system. It creates the worker, starts
`worker.run()`, hands the live worker to your callback, then always calls
`worker.shutdown()` and awaits the run promise in a `finally` before
returning — draining the reference cleanly whether your callback succeeded,
threw, or did nothing. `bootWorker` (the boot-sanity-check used by preflight)
is just `withRunningWorker` with a no-op callback. **Almost no check should
call `Worker.create()` directly** — if a check needs the worker to actually
process tasks (most do: starting a workflow and waiting on it), call
`withRunningWorker` and do that work inside its callback, so it inherits this
fix automatically instead of re-discovering, or re-fixing inconsistently, the
same bug.

**The one narrow, documented exception**: a check that needs TWO sequential
worker lifecycles in a row against the same environment — stop worker #1,
start worker #2 — to prove something survives a worker restart (D1's timer
survival, I5's sticky-queue recovery). `withRunningWorker` only manages one
worker for the lifetime of its callback, so these checks call
`Worker.create()` / `worker.run()` / `worker.shutdown()` directly, twice,
inside their own function — each call site has a comment explicitly
referencing this CLAUDE.md section so it doesn't read as a missed rule.
Follow the exact same run-then-shutdown symmetry as `withRunningWorker` for
*each* worker before moving to the next one or tearing down the environment.
If you're writing a check like this, also pass `maxCachedWorkflows: 0` to
both `Worker.create()` calls — D1 discovered that without it, the SDK's
sticky-task-queue caching makes the server wait out a real (non-time-skippable)
schedule-to-start timeout before falling back off the now-dead worker,
which made a naive version of this pattern hang for 90+ seconds instead of
completing in a few.

## Per-check timeout and error isolation

Every check's execution — inside the dynamic engine's orchestration loop
(currently `zeroFixtureDynamicResults` in `src/cli.ts`) — is wrapped in
`runCheckWithGuards` (`src/engines/dynamic/run-check.ts`), never called
directly. This is a shared orchestrator concern, deliberately **not**
duplicated inside each check file:

- **Timeout**: if a check doesn't resolve within `DEFAULT_CHECK_TIMEOUT_MS`
  (currently 15s), `runCheckWithGuards` gives up on it and reports `ERRORED`
  instead of letting one hung check (e.g. waiting on a workflow that never
  completes) block the rest of the audit run indefinitely.
- **Error isolation**: if a check throws — a bug in the check's own code, not
  a finding about the project under test — `runCheckWithGuards` catches it
  and reports `ERRORED`, never `FAIL`. This is what keeps "the tool broke"
  from ever being misreported as "the app broke."

A check file's own exported function should just return a `TestResult`
(PASS/FAIL/SKIPPED/N_A/NOT_COVERED) or let an exception propagate — it should
never try to catch its own bugs into ERRORED, and never implement its own
timeout. That's the orchestrator's job, done once.

## Workflow ID convention

Because Phase 2b runs all 16 zero-fixture checks against one shared `env`
(and often the same task queue) rather than giving each check its own fresh
environment, every workflow a check starts must use
`generateWorkflowId(testId, workflowType)` from
`src/engines/dynamic/workflow-id.ts` — never a hand-rolled ID, never a bare
`workflowType` or `Date.now()` alone (both can collide between checks running
close together or, for `Date.now()` alone, within the same millisecond). It
produces `ttk-<testId>-<workflowType>-<timestamp>-<random>`, which is
collision-safe across every check and also makes IDs recognizable by test in
the Temporal Web UI while debugging. See `i3.ts`'s `recordWorkflowHistory`
for the reference usage.

## Testing

TDD throughout: a failing test before any production code. Preflight checks
and the report engine are pure/unit-testable; the ephemeral-environment and
worker-boot pieces (`src/engines/dynamic/environment.ts`) are verified against
the real `@temporalio/testing` package and the throwaway fixture project in
`examples/sample-project/` rather than mocked, since mocking Temporal's own
SDK internals would test the mock, not the integration.

`examples/sample-project/` is a minimal, throwaway Temporal project (one
workflow, one activity, one signal) used purely as a fixture to exercise
preflight/worker-boot/checks against something real. It is not published and
not part of this package's own build.
