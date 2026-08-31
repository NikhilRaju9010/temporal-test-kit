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

## The 5 report statuses

Every check result carries exactly one of five statuses. They are never
collapsed or treated as equivalent — this honesty is the entire point of the
tool:

- **PASS** — the check ran and found no problem.
- **FAIL** — the check ran and found a real problem. Always carries a
  non-empty `hint` (why it matters + how to fix it).
- **SKIPPED** — the check needs fixture data from `temporal-test-kit.config.json`
  that wasn't provided. Always carries a non-empty `hint` naming exactly which
  config field would unlock it. Never shown as a pass.
- **N_A** — the check doesn't apply because this project doesn't use that
  Temporal feature at all (a `features.*` flag in config is false/unset).
  Distinct from SKIPPED: N_A means "doesn't apply here," not "missing info."
- **NOT_COVERED** — the check requires real infrastructure (multi-cluster,
  staging, load testing) that this local tool can never provide. Always
  appears in the report, never silently dropped.

`ResultCollector.add()` (`src/report/collect.ts`) enforces the FAIL/SKIPPED
hint requirement at runtime — it throws if you try to add a FAIL or SKIPPED
result with no hint. If you hit that error while writing a check, you're
missing a required field, not encountering a bug in the collector.

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

`bootWorker` in `src/engines/dynamic/environment.ts` is the fix: it starts
`worker.run()`, immediately calls `worker.shutdown()`, and awaits the run
promise before returning, which drains the reference cleanly. This is not
optional plumbing — **it is the only sanctioned way any check boots a
worker.** No check under `src/engines/dynamic/checks/` should call
`Worker.create()` directly; route through `bootWorker` (or a check-specific
helper that itself calls `bootWorker`/wraps the same run-then-shutdown
pattern) so every check inherits this fix automatically instead of
re-discovering — or re-fixing inconsistently — the same bug. If a check
needs the worker to actually process tasks (most of Phase 2b's checks will),
extend `bootWorker`'s pattern rather than bypassing it: keep the run/shutdown
symmetry so the connection reference is always released before
`env.teardown()` runs, regardless of how the check itself succeeds or fails.

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
