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

### All 16 zero-fixture checks are built — I1 and L1 needed dedicated infra

I1 (worker crash recovery) and L1 (Temporal Server outage recovery) were the
last two of the spec's 16 zero-fixture dynamic checks, and both needed real
infrastructure control beyond what `withRunningWorker`'s in-process, single-
connection model provides. Building a fake version of either would have
silently under-tested exactly what their names promise, so each got its own
deliberate design instead:

- **I1** needs a worker to die *ungracefully* mid-task (no drain, no
  `shutdown()`, task token abandoned). Confirmed empirically: an in-process
  `Worker` cannot be forced into this state — the SDK blocks closing its
  connection out from under it (`IllegalStateError`, the same guard behind
  the "Worker lifecycle gotcha" above), and nothing short of killing the OS
  process stops its poll loop. I1 uses `spawnKillableWorker`
  (`src/engines/dynamic/child-worker.ts`) — a **real, separate OS child
  process** running `child-worker-entry.ts` (a generic bootstrap script:
  connects, boots a `Worker`, prints `WORKER_BOUND`, then just calls
  `worker.run()` with **no shutdown handling at all**, deliberately, since
  the only way it's meant to stop is a real signal killing it). This is
  intentionally separate from `withRunningWorker` — that path's whole
  contract is graceful shutdown-then-release, the opposite of what a
  killable worker needs — and separate from L1's infra too (see below): I1's
  `i1.ts` spawns two of these processes against its own private environment,
  kills the first mid-activity (once the activity's own "started" marker
  file confirms it's genuinely executing, not just polling), and confirms a
  fresh worker/process completes the retried activity's real side effect
  exactly once (`fixtures/i1-activities.ts` + `fixtures/i1-side-effect-workflow.ts`).
  I1 is allowed 40s in `ZERO_FIXTURE_CHECKS`' `timeoutMs` override (vs. the
  default 15s) — waiting out a real activity timeout and retry is what the
  check is testing, not something to optimize away.
- **L1** needs the actual Temporal *server* process to go down and come
  back. `TestWorkflowEnvironment` exposes no pause/resume for its embedded
  server — only permanent `teardown()` — and the underlying native binding
  (`@temporalio/core-bridge`) has no such capability at all to reach for
  either; confirmed while building this, not assumed. So L1 (`l1.ts`) ships
  the narrower, honestly-labeled version instead of blocking on the
  unbuildable faithful one: its own private environment, an explicit
  `NativeConnection.close()` mid-workflow (a real, verified disconnect — not
  a stand-in), then a brand-new connection + worker picking the workflow's
  second task back up (`fixtures/l1-two-task-workflow.ts`, same
  two-workflow-task shape as I5's fixture, for the same reason — see below).
  This proves SDK/connection-level reconnection, **not** server-outage
  survival — the real embedded server stays up and unaffected throughout,
  by design. Per the same honesty principle behind the six report statuses,
  L1's `TestResult.target` and every message/hint say this explicitly (e.g.
  `"...connection-loss only, not full server outage"`) — never let this
  check's PASS read as a broader claim than what it actually tested. If
  `@temporalio/testing` ever exposes real server pause/resume, this is the
  check to revisit — not to replace, since connection-loss recovery remains
  a real thing worth testing on its own, but to add the faithful version
  alongside it.

Both use the CLAUDE.md "Zero-fixture checks needing their own probe
workflow" pattern (private environment, not the shared `env`) and I5/D1's
documented exception to `withRunningWorker` where a check genuinely needs
more than one worker lifecycle in a row.

## Interrupt-safe cleanup (`src/engines/dynamic/cleanup-registry.ts`)

Before I1 existed, `withEphemeralEnvironment`'s SIGINT/SIGTERM handler only
knew about the ONE environment it wrapped: on Ctrl+C it tore that down, then
called `process.exit()` — which terminates the process before any check's
own `finally` block gets a chance to run. That was invisible as long as
every disposable resource a check might hold was just in-process JS state
(nothing to leak once the process is gone), but I1/L1's own private
environments, and I1's real OS child-process workers, are both external
resources that outlive a bare `process.exit()` if nothing explicitly kills
them first.

`registerCleanup(fn)` / `runAllCleanups()` fix this generically: anything
that owns a disposable resource registers a cleanup for it (and unregisters
once its own normal, non-interrupted cleanup has run, so nothing double-runs).
`withEphemeralEnvironment` registers its own env's teardown through this
same mechanism rather than special-casing itself, so its SIGINT handler now
runs the FULL set of currently-registered cleanups — the main env, plus
whatever a check has registered on its own (I1/L1's private env,
`spawnKillableWorker`'s spawned process) — not just its own. Any future
check that owns its own disposable resource (a private environment, a
spawned process, anything else that would leak past a bare `process.exit()`)
should register it here the same way.

Verified for real, not just reasoned through: spawned `verify-sigint.ts`
(a standalone script running `checkI1WorkerCrashRecovery`) as its own OS
process, confirmed a real killable child-worker process was alive via `ps`,
sent it a genuine `SIGINT` from outside, and confirmed the whole process
tree (the ephemeral server *and* the child-worker process) was gone
afterward — no orphans, no zombies (`ps` showed no `Z` state entries, and a
reaped child no longer answers `kill(pid, 0)` at all, which is what
`spawnKillableWorker`'s `kill()` waits on before resolving).

## Spawning a real child-process worker without a dist/src path split

`child-worker.ts`'s `spawnKillableWorker` needs to run `child-worker-entry.ts`
as a genuinely separate OS process, both under `vitest` (source `.ts` on
disk) and from the built `dist/cli.js` (compiled `.js` on disk, no `.ts`
sibling — `tsc` doesn't copy source files, only emits compiled output). This
is the same class of bug as the fixture-copy gotcha below, but the fix here
is different and simpler: `child-worker-entry.ts`'s compiled `.js` output is
already valid on its own (it isn't consumed by Temporal's workflow bundler
the way `checks/fixtures/*.ts` files are, so there's no reason to require
raw source for it), so instead of adding a copy step, `child-worker.ts`
resolves its own sibling entry file by matching **its own** file extension
(`import.meta.url.endsWith(".ts") ? ".ts" : ".js"`) and always spawns it via
`node --import tsx <path>` — `tsx` transforms `.ts` and passes `.js` through
as a no-op, so the same spawn command works unmodified in both run modes. If
you ever add a second script meant to be spawned as its own process, use
this same self-extension-matching approach rather than hardcoding `.ts` (that
mistake shipped once already during I1's build, and only surfaced by
actually running `dist/cli.js`, not `vitest` — the exact failure mode the
fixture-copy note below warns about).

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

**A second documented exception**: `withFaultInjectedWorker`
(`src/engines/dynamic/fault-injection.ts`), the shared piece behind G1
(saga/compensation), L2 (dependency outage), and B3 (idempotency) — each
names one activity via its own config field and needs it to misbehave on
demand, without any cooperation from the target project's own code.
`withRunningWorker` takes a `WorkerTarget`'s `activities` map as-is and has
no hook to substitute a single entry, which is exactly what fault injection
needs (run everything else UNCHANGED, swap out just one function) — so this
is its own function, not a parameter bolted onto `withRunningWorker` that
nothing else would use. It reproduces `withRunningWorker`'s exact
create-run-shutdown-in-a-finally contract, **and**, because it's a direct
`Worker.create()` call site, it registers that shutdown with
`cleanup-registry.ts` itself (`registerCleanup`/unregister-on-normal-exit),
the same way I1/L1's own directly-created resources do — skipping that
would silently reintroduce the exact interrupt-time leak Phase 2b's
cleanup-registry work fixed, for every fixture check built on this. Verified
directly in `fault-injection.test.ts`: a simulated interrupt firing WHILE
the callback is still running (calling `runAllCleanups()` mid-callback)
releases the worker's connection reference immediately, not only once
`withFaultInjectedWorker`'s own `finally` eventually runs.

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

### Known gap: the timeout doesn't actually cancel the hung check (real resource leak, reproduced)

`runCheckWithGuards`'s timeout is `Promise.race([fn(), timeoutPromise])`. When
`timeoutPromise` wins, `fn()` is **not cancelled** — there is no
`AbortController`/cancellation threaded through any check, so the loser just
keeps running, completely detached, with nothing left awaiting it. The
orchestrator correctly reports `ERRORED` for that check's row in the output,
but whatever the abandoned `fn()` was doing internally — most importantly, a
worker it registered via `withRunningWorker` — keeps running for real. If the
check's own internal wait had a bound (most do, e.g. a `Promise.race` against
its own shorter timeout), that abandoned worker eventually shuts down on its
own once that inner wait settles, just later than the report suggests. But if
a check's internal wait has NO bound of its own (e.g. `handle.query(...)`
with nothing racing it, awaiting a workflow that will never answer because it
never actually started), the abandoned worker **never** shuts down — for the
rest of that audit run's process lifetime, `withRunningWorker`'s own `finally`
(`worker.shutdown()` + await) can't run because the callback holding it open
never returns.

This is not theoretical — it was reproduced running a real audit against
`init`'s own generated template (worked-example workflow names that don't
exist in the target project): a check waiting on a query to `OrderWorkflow`
(which never started, since that workflow type isn't real) hung past its
15s timeout and reported `ERRORED` as designed, but the NEXT check to run
against the same `taskQueue` ("orders") then failed for real, with a
Temporal server error: `"Registration of multiple workers with overlapping
worker task types... task_queue: orders"` — proof the first check's worker
was still live and holding that queue.

Not fixed here — this is a real architectural gap, not a one-line patch.
Whoever picks it up: the general direction is threading a cancellation
signal (`AbortSignal` or similar) from `runCheckWithGuards` through to
`withRunningWorker`/`withFaultInjectedWorker`/each check's own internal
waits, so a check can actually be torn down on timeout rather than merely
stopped-being-awaited. A narrower, partial mitigation — auditing every
check's OWN internal waits to confirm none of them are unbounded (always
race against something, per this file's own established pattern) — would
at least guarantee "leaked worker eventually shuts down late" instead of
"leaked worker never shuts down," without solving true cancellation.

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

## Known follow-up cleanup: uncleared `Promise.race` timers (~20 files, not yet fixed)

Every check that bounds a real SDK call with a timeout uses the pattern
`Promise.race([realPromise, new Promise(resolve => setTimeout(resolve, MS))])`.
When `realPromise` wins the race, that pattern leaves the losing side's
`setTimeout` **uncleared** — a dangling timer that still fires later
regardless, on its own schedule, with nothing left to do.

This was diagnosed twice, independently, while building the last several
Phase 3 checks:

- **E2**: the dangling timer combined with a rapid, zero-delay signal-burst
  loop to reliably produce lost signals around a Continue-As-New boundary
  (a real, confirmed Temporal SDK/protocol caveat — separate root cause,
  see `e2.ts`'s `SIGNAL_BUDGET` comment) *and* an unhandled `"Channel has
  been shut down"` gRPC error once the timer outlived `env.teardown()`.
- **K2/L2**: the same `"Channel has been shut down"` error surfaced,
  attributed to `l2.test.ts`, while multiple agents' test suites ran
  concurrently under heavy load. Root-caused to `l2.ts`'s own uncleared
  `Promise.race` timer and fixed. Re-verified afterward: this class of
  error **still reproduces** running the full suite (`npx vitest run`)
  even with `l2.ts` fixed, still attributed to `l2.test.ts` — confirming
  it's actually coming from one of the other ~20 still-unfixed files, just
  surfacing at whatever moment `l2.test.ts` happens to be the active file
  when a stale timer from elsewhere finally fires. Never reproduces
  running any single file in isolation.
- **Severity update, found running the full suite during Phase 4 work**:
  this is NOT purely cosmetic console noise. One `npx vitest run` left TWO
  real orphaned `temporal-sdk-typescript` ephemeral-server OS processes
  behind (confirmed via `ps` — both reparented to PID 1/init, meaning
  their own process's `env.teardown()` never ran before that process
  exited/crashed). Manually `kill -9`'d as part of that verification pass.
  This means the full-suite flake isn't just a scary-looking stack trace —
  it can genuinely leak real child processes that outlive the test run
  entirely. Worth treating as a real resource leak, not merely log noise,
  when this gets prioritized.

**The fix** (already applied in `e2.ts`, `k2.ts`, `l2.ts` — each has its own
local copy of the same few lines, not a shared export yet): wrap the race in
something that clears the timer on whichever side wins, e.g.

```ts
function raceWithTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T | PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

**Not yet fixed** — confirmed via `grep` to still have the bare,
timer-leaking pattern (`Promise.race` + `setTimeout`, no `clearTimeout`
anywhere in the file):
`a1.ts`, `a4.ts`, `b3.ts`, `b4.ts`, `c1.ts`, `c5.ts`, `d1.ts`, `e1.ts`,
`f1.ts`, `g1.ts`, `h1.ts`, `h3.ts`, `i1.ts`, `i3.ts`, `i4.ts`, `i5.ts`,
`j1.ts`, `j2.ts`, `j3.ts`, `l1.ts` — 20 files, all already-shipped and
passing today. None of these have been observed to actually fail a test or
leak a process from this specific pattern; this is a real latent bug worth
closing, not an active incident.

Whoever picks this up: extract `raceWithTimeout` into a shared module
(`src/engines/dynamic/race-with-timeout.ts` or similar) rather than
copy-pasting a fourth/fifth local definition, update the three existing
copies to import it, then replace each bare `Promise.race([x, new
Promise(...setTimeout...)])` in the 20 files above with a call to it. Purely
mechanical, file-by-file, low risk — no design decisions left to make.

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
