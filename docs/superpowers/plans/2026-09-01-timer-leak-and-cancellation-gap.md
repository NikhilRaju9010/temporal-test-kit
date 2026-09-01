# Timer-Leak Cleanup + Timeout-Cancellation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close both follow-ups documented in commit `fc13ee4`: (1) the ~20-file uncleared `Promise.race`/`setTimeout` timer pattern that can leak real OS processes, and (2) `runCheckWithGuards`'s timeout not actually cancelling a hung check's worker, which corrupts later checks sharing the same task queue.

**Architecture:** Extract the already-proven `raceWithTimeout` helper (currently duplicated in `e2.ts`/`k2.ts`/`l2.ts`) into a shared module and apply it everywhere the bare, timer-leaking pattern still exists. Separately, thread a `signal?: AbortSignal` from `runCheckWithGuards` down through each check function into `withRunningWorker`/`withFaultInjectedWorker`, so on timeout those two functions shut the worker down immediately instead of waiting for the abandoned check callback to unwind on its own (which, if the callback is waiting on something truly unbounded, never happens).

**Tech Stack:** TypeScript (strict), Vitest, `@temporalio/testing` / `@temporalio/worker`, Node's built-in `AbortController`/`AbortSignal` (confirmed to type-check under this project's exact tsconfig via `@types/node`, no `dom` lib needed).

**Spec:** `CLAUDE.md` sections "Per-check timeout and error isolation" (line 307) and "Known follow-up cleanup: uncleared `Promise.race` timers" (line 383) are this plan's spec — they contain the full diagnosis, the exact reproduction steps, and the fix direction this plan implements. Re-read both before starting; this plan does not repeat their reasoning, only the parts needed to act.

## Answer to the ordering question (read before starting)

**The two bugs are related but not the same bug, and fixing #1 does not by itself fix #2.** Investigation for this plan found the actual root cause of the reproduced `OrderWorkflow` collision: `src/engines/dynamic/checks/c2.ts:46-47` calls `await handle.query(queryName)` **with no `Promise.race`/timeout at all** — not even the buggy uncleared-timer pattern. It's not on CLAUDE.md's 20-file "not yet fixed" list because it never had a timer to leak in the first place; it's a *more* unbounded wait than the pattern being fixed. This means:

- Fix #1 (extract `raceWithTimeout`, apply to the 20 listed files) would **not** have prevented the reproduced collision, because `c2.ts` isn't one of the 20 files.
- Fix #2 (thread an abort signal into `withRunningWorker` so it shuts the worker down on timeout regardless of what the check's own callback is doing) **is** what actually closes the reproduced collision, because it acts at the worker level, not the individual-wait level.

**Fix order:** Fix #1 first anyway, for two reasons that make it a genuine prerequisite rather than just tidiness: (a) CLAUDE.md's own text calls the bounded-internal-waits property a *partial mitigation* of #2 ("would at least guarantee 'leaked worker eventually shuts down late' instead of 'leaked worker never shuts down'") — every check's internal race should be well-behaved before layering an abort mechanism on top of it; (b) Fix #2's implementation reuses the same shared race-helper module Fix #1 creates (a sibling `raceWithSignal` alongside `raceWithTimeout`), so having that module in place first avoids building it twice. As a direct, targeted consequence of the c2.ts finding above, this plan also wraps `c2.ts`'s two unbounded `handle.query()` calls in `raceWithTimeout` (Task 3) even though the file wasn't on CLAUDE.md's original 20-file list — it's the exact call that produced the reported collision, and bounding it is cheap, real defense-in-depth on top of the withRunningWorker-level fix.

## Global Constraints

- TypeScript `strict` mode, no `noUnusedParameters` — an unused trailing `signal` parameter compiles fine without an underscore prefix, but this codebase's convention (see `i1.ts`'s `_env`/`_target`) prefixes genuinely-unused params with `_`; follow that convention for any check that receives `signal` but has no live worker to forward it to.
- Never call `Worker.create()` directly outside `withRunningWorker`/`withFaultInjectedWorker`, except the three documented two-sequential-worker exceptions (`d1.ts`, `i5.ts`, `l1.ts` — see CLAUDE.md's "Worker lifecycle gotcha"). This plan does not change that rule or touch those three files' worker-management code.
- `withRunningWorker`'s `finally { worker.shutdown(); await runPromise }` contract (draining the `NativeConnection` reference) must still run to completion on every path, including the new abort path — this is the exact invariant CLAUDE.md's "Worker lifecycle gotcha" documents `IllegalStateError: Cannot close connection while Workers hold a reference to it` for. Task 4's design satisfies this by calling shutdown *before* returning/throwing on the abort branch, not by skipping it.
- Every new/changed check function signature must remain callable with the same arguments existing tests already use (`signal` is always the last, optional parameter) — do not break any existing test file's call sites in this plan.
- `npx tsc --noEmit` must stay clean after every task.

---

## File Structure

New files:
- `src/engines/dynamic/race.ts` — `raceWithTimeout` (extracted, unchanged behavior) and the new `raceWithSignal`.
- `src/engines/dynamic/race.test.ts` — unit tests for both.

Modified (grouped by task below):
- `src/engines/dynamic/checks/e2.ts`, `k2.ts`, `l2.ts` — drop local `raceWithTimeout` copies, import the shared one.
- `src/engines/dynamic/checks/{a1,a4,b3,b4,c1,c2,c5,d1,f1,g1,h1,h3,i1,i3,i4,i5,j1,j2,j3,l1}.ts` — apply `raceWithTimeout` to bare `Promise.race([x, setTimeout...])` call sites (`c2.ts` added beyond CLAUDE.md's list per the finding above).
- `src/engines/dynamic/run-check.ts` — `runCheckWithGuards` creates an `AbortController`, passes `controller.signal` into `fn`, calls `controller.abort()` when the timeout wins.
- `src/engines/dynamic/environment.ts` — `withRunningWorker` accepts optional `signal`, uses `raceWithSignal` to shut the worker down immediately on abort.
- `src/engines/dynamic/fault-injection.ts` — `withFaultInjectedWorker` gets the identical treatment.
- `src/cli.ts` — `ZeroFixtureCheckFn`/`DynamicFixtureCheckFn`-equivalent call sites create one `AbortController` per check invocation and pass `signal` through.
- `src/engines/dynamic/fixture-check.ts` — `DynamicFixtureCheckFn` type gains an optional `signal` parameter.
- 25 check files that call `withRunningWorker`/`withFaultInjectedWorker` (`a1,a3,a4,b3,b4,b5,c1,c2,c3,c4,c5,e1,e2,f1,f2,g1,h1,h2,h3,i3,i4,j1,j3,k2,l2`) — accept `signal` and forward it into their `withRunningWorker`/`withFaultInjectedWorker` call.
- `src/engines/dynamic/environment.test.ts`, `src/engines/dynamic/fault-injection.test.ts` — new tests proving the worker shuts down on abort even though the callback never returns.
- `src/cli-init-audit.e2e.test.ts` — re-tighten expectations once cancellation actually works; possibly relocate.
- `vitest.config.ts` / `vitest.e2e.config.ts` / `package.json` — only if Task 10 confirms the e2e test is fast enough to move back to the default suite.
- `CLAUDE.md` — mark both "Known gap"/"Known follow-up" sections resolved, replaced with a short "how this was fixed" note (Task 11).

---

## Task 1: Extract `raceWithTimeout` into a shared module

**Files:**
- Create: `src/engines/dynamic/race.ts`
- Create: `src/engines/dynamic/race.test.ts`

**Interfaces:**
- Produces: `raceWithTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T | PromiseLike<T>): Promise<T>` — every later task that applies this to a check file imports this exact signature from `../race.js` (or `./race.js` from `run-check.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/engines/dynamic/race.test.ts
import { describe, expect, it, vi } from "vitest";
import { raceWithTimeout } from "./race.js";

describe("raceWithTimeout", () => {
  it("resolves with the real promise's value when it wins, and clears the timer (no dangling setTimeout)", async () => {
    vi.useFakeTimers();
    try {
      const real = Promise.resolve("real value");
      const onTimeout = vi.fn(() => "timeout value");
      const result = await raceWithTimeout(real, 1_000, onTimeout);
      expect(result).toBe("real value");
      expect(onTimeout).not.toHaveBeenCalled();
      // If the timer weren't cleared, this would still be pending — confirm none are.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves with onTimeout()'s value when the timeout wins, and clears no leftover timer", async () => {
    vi.useFakeTimers();
    try {
      const real = new Promise<string>(() => {}); // never resolves
      const promise = raceWithTimeout(real, 1_000, () => "timeout value");
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;
      expect(result).toBe("timeout value");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave a pending timer running after the real promise wins (regression for the uncleared-timer bug)", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    await raceWithTimeout(Promise.resolve(1), 50, () => 2);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engines/dynamic/race.test.ts`
Expected: FAIL — `race.ts` does not exist yet (`Cannot find module './race.js'`).

- [ ] **Step 3: Write the implementation**

This is `k2.ts`'s existing local `raceWithTimeout` (already proven correct — see `git show k2.ts` history), moved verbatim into its own module so it can be imported instead of copy-pasted:

```typescript
// src/engines/dynamic/race.ts

/**
 * Races `promise` against a timeout, resolving with `onTimeout()`'s value if
 * the timeout wins. Unlike a bare `Promise.race([promise, new
 * Promise(resolve => setTimeout(resolve, ms))])`, this clears the timer on
 * whichever side wins — the bare pattern leaves the loser's `setTimeout`
 * running regardless, a dangling timer that fires later on its own schedule
 * with nothing left to do. Under full-suite concurrency that's been
 * confirmed to produce a real "Channel has been shut down" gRPC error (a
 * stale timer firing after some OTHER test file's `env.teardown()` already
 * ran) and, in the worst case, real orphaned `temporal-sdk-typescript`
 * ephemeral-server OS processes (see CLAUDE.md's now-resolved "Known
 * follow-up cleanup" section for the original diagnosis).
 */
export function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T | PromiseLike<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engines/dynamic/race.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: `npx tsc --noEmit`**

Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/engines/dynamic/race.ts src/engines/dynamic/race.test.ts
git commit -m "Extract raceWithTimeout into a shared module (src/engines/dynamic/race.ts)"
```

---

## Task 2: Point `e2.ts`/`k2.ts`/`l2.ts` at the shared `raceWithTimeout`

**Files:**
- Modify: `src/engines/dynamic/checks/e2.ts` (remove local `raceWithTimeout` at line 21-27, add import)
- Modify: `src/engines/dynamic/checks/k2.ts` (remove local `raceWithTimeout` at line 30-36, add import)
- Modify: `src/engines/dynamic/checks/l2.ts` (inline `Promise.race` at lines 124-130 — convert to a call, add import)

**Interfaces:**
- Consumes: `raceWithTimeout` from `../race.js` (Task 1).

- [ ] **Step 1: `e2.ts` — remove the local copy, import the shared one**

Read the file first to confirm current line numbers, then:
- Delete the local `function raceWithTimeout<T>(...)  { ... }` block (currently lines 21-27).
- Add `import { raceWithTimeout } from "../race.js";` near the top with the other relative imports.
- Every existing `raceWithTimeout(...)` call site in the file (lines ~149, ~215, ~258) is unchanged — same name, same signature, now resolved via import instead of local declaration.

- [ ] **Step 2: `k2.ts` — same treatment**

- Delete the local `function raceWithTimeout<T>(...)` block (currently lines 30-36).
- Add `import { raceWithTimeout } from "../race.js";`.
- Existing call site at line ~195 unchanged.

- [ ] **Step 3: `l2.ts` — convert the inline `Promise.race` to a `raceWithTimeout` call**

Current code (around line 118-132):

```typescript
    const history = await withFaultInjectedWorker(env, target, activityName, forceOutageThenRecover, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });
      let resultTimer: ReturnType<typeof setTimeout>;
      await Promise.race([
        handle.result().catch(() => {}),
        new Promise((resolve) => {
          resultTimer = setTimeout(resolve, RESULT_WAIT_MS);
        }),
      ]).finally(() => clearTimeout(resultTimer));
      return handle.fetchHistory();
    });
```

Replace with:

```typescript
    const history = await withFaultInjectedWorker(env, target, activityName, forceOutageThenRecover, async () => {
      const handle = await env.client.workflow.start(target.type, {
        taskQueue: target.taskQueue,
        workflowId,
        args,
      });
      await raceWithTimeout(handle.result().catch(() => {}), RESULT_WAIT_MS, () => undefined);
      return handle.fetchHistory();
    });
```

Add `import { raceWithTimeout } from "../race.js";` near the top.

- [ ] **Step 4: Run the three files' own tests**

Run: `npx vitest run src/engines/dynamic/checks/e2.test.ts src/engines/dynamic/checks/k2.test.ts src/engines/dynamic/checks/l2.test.ts`
Expected: PASS, same test counts as before this task (no behavior change, only where the function is defined).

- [ ] **Step 5: `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/engines/dynamic/checks/e2.ts src/engines/dynamic/checks/k2.ts src/engines/dynamic/checks/l2.ts
git commit -m "Point e2/k2/l2 at the shared raceWithTimeout instead of three local copies"
```

---

## Task 3: Apply `raceWithTimeout` — batch A (`a1, a4, b3, b4, c1, c2, c5, d1, f1, g1`)

**Files:** (all under `src/engines/dynamic/checks/`)
- Modify: `a1.ts` (lines 51-62 and 77)
- Modify: `a4.ts` (lines 61-63)
- Modify: `b3.ts` (lines 96-104)
- Modify: `b4.ts` (lines 204-206)
- Modify: `c1.ts` (lines 58-61)
- Modify: `c2.ts` (lines 46-47 — the finding above; not on CLAUDE.md's original list, added here because it's the actual unbounded call behind the reproduced collision)
- Modify: `c5.ts` (lines 66-68, 84-86)
- Modify: `d1.ts` (lines 130-136)
- Modify: `f1.ts` (lines 149-151)
- Modify: `g1.ts` (lines 68-70)

**Interfaces:**
- Consumes: `raceWithTimeout` from `../race.js` (Task 1).

For each file: **read it first** to see the exact surrounding code (some capture a result via closure, some race against a rejecting timer, not all are identical shape), then apply the mechanical transform below to that file's specific case. Two worked examples first, since they cover every shape that appears in this batch; the rest follow the same two patterns.

### Worked example 1 — a "soft" race with no reject (side effects via closure): `a1.ts`

Current (lines 51-62):

```typescript
    let resultValue: unknown;
    let resultCaptured = false;
    await Promise.race([
      handle
        .result()
        .then((r) => {
          resultValue = r;
          resultCaptured = true;
        })
        .catch(() => {
          // Failure is reflected in describe().status below; nothing to do here.
        }),
      new Promise((resolve) => setTimeout(resolve, WAIT_TIMEOUT_MS)),
    ]);
```

Replace with:

```typescript
    let resultValue: unknown;
    let resultCaptured = false;
    await raceWithTimeout(
      handle
        .result()
        .then((r) => {
          resultValue = r;
          resultCaptured = true;
        })
        .catch(() => {
          // Failure is reflected in describe().status below; nothing to do here.
        }),
      WAIT_TIMEOUT_MS,
      () => undefined,
    );
```

And the second occurrence in the same file (line 77):

```typescript
      await Promise.race([handle.result().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3_000))]);
```

becomes:

```typescript
      await raceWithTimeout(handle.result().catch(() => {}), 3_000, () => undefined);
```

Add `import { raceWithTimeout } from "../race.js";` near the top.

### Worked example 2 — a race that rejects on timeout: `c1.ts`

Read the file around line 58-61 first (it's inside a ternary and captures a query-specific timeout message). The pattern is:

```typescript
Promise.race([
  someRealPromise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`query ${queryName} did not resolve within ${QUERY_WAIT_MS}ms`)), QUERY_WAIT_MS)),
])
```

`raceWithTimeout`'s `onTimeout` callback can itself throw to preserve reject-on-timeout behavior — it doesn't have to resolve:

```typescript
raceWithTimeout(someRealPromise, QUERY_WAIT_MS, () => {
  throw new Error(`query ${queryName} did not resolve within ${QUERY_WAIT_MS}ms`);
})
```

(`e2.ts`, already fixed in Task 2, has multiple examples of this exact reject-on-timeout usage at lines ~149 and ~215 — use those as a second reference if a given file's shape is ambiguous.)

### Now apply to every file in this batch

For each of `a4.ts`, `b3.ts`, `b4.ts`, `c1.ts`, `c2.ts`, `c5.ts`, `d1.ts`, `f1.ts`, `g1.ts`:

1. Read the file at the line numbers listed above.
2. Identify which worked example it matches (resolve-only vs reject-on-timeout — most in this codebase are resolve-only/soft, matching example 1; check by whether the second `Promise.race` element uses `(resolve)` or `(_, reject)`).
3. Replace the `Promise.race([...])` block with the equivalent `raceWithTimeout(...)` call, preserving the exact same timeout constant and exact same behavior on timeout (don't change what happens when the timeout fires — only how the timer is cleaned up).
4. Add `import { raceWithTimeout } from "../race.js";`.

`c2.ts` specifically (lines 46-47) has **no existing race at all** — this is the new bound being added, not a refactor of an existing one:

Current:

```typescript
        const first = await handle.query(queryName);
        const second = await handle.query(queryName);
```

Replace with:

```typescript
        const first = await raceWithTimeout(handle.query(queryName), QUERY_TIMEOUT_MS, () => {
          throw new Error(`query ${queryName} did not resolve within ${QUERY_TIMEOUT_MS}ms`);
        });
        const second = await raceWithTimeout(handle.query(queryName), QUERY_TIMEOUT_MS, () => {
          throw new Error(`query ${queryName} did not resolve within ${QUERY_TIMEOUT_MS}ms`);
        });
```

Add a `QUERY_TIMEOUT_MS` constant near the top of `c2.ts` (check the file for an existing similarly-named constant first — reuse it if one already exists; otherwise add `const QUERY_TIMEOUT_MS = 5_000;` following this file's existing constant-naming convention, comfortably under `runCheckWithGuards`'s 15s default budget with room for the rest of the check's own bookkeeping). Add the `raceWithTimeout` import.

- [ ] **Step: Run each touched file's own test**

Run: `npx vitest run src/engines/dynamic/checks/a1.test.ts src/engines/dynamic/checks/a4.test.ts src/engines/dynamic/checks/b3.test.ts src/engines/dynamic/checks/b4.test.ts src/engines/dynamic/checks/c1.test.ts src/engines/dynamic/checks/c2.test.ts src/engines/dynamic/checks/c5.test.ts src/engines/dynamic/checks/d1.test.ts src/engines/dynamic/checks/f1.test.ts src/engines/dynamic/checks/g1.test.ts`
Expected: PASS, same test counts as before this task.

- [ ] **Step: `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step: Confirm no bare leaking pattern remains in this batch**

Run: `grep -n "Promise.race(\[" src/engines/dynamic/checks/{a1,a4,b3,b4,c1,c2,c5,d1,f1,g1}.ts`
Expected: no output (every bare `Promise.race([` in these 10 files has been converted).

- [ ] **Step: Commit**

```bash
git add src/engines/dynamic/checks/a1.ts src/engines/dynamic/checks/a4.ts src/engines/dynamic/checks/b3.ts src/engines/dynamic/checks/b4.ts src/engines/dynamic/checks/c1.ts src/engines/dynamic/checks/c2.ts src/engines/dynamic/checks/c5.ts src/engines/dynamic/checks/d1.ts src/engines/dynamic/checks/f1.ts src/engines/dynamic/checks/g1.ts
git commit -m "Apply shared raceWithTimeout to a1/a4/b3/b4/c1/c5/d1/f1/g1 (+ c2, newly bounded)"
```

---

## Task 4: Apply `raceWithTimeout` — batch B (`h1, h3, i1, i3, i4, i5, j1, j2, j3, l1`)

**Files:** (all under `src/engines/dynamic/checks/`)
- Modify: `h1.ts` (lines 55-57)
- Modify: `h3.ts` (lines 120-122)
- Modify: `i1.ts` (lines 121-126)
- Modify: `i3.ts` (lines 38-40)
- Modify: `i4.ts` (lines 36-38)
- Modify: `i5.ts` (lines 128-133)
- Modify: `j1.ts` (lines 73-82)
- Modify: `j2.ts` (lines 111-114)
- Modify: `j3.ts` (lines 99-101, 121)
- Modify: `l1.ts` (lines 126-131)

**Interfaces:**
- Consumes: `raceWithTimeout` from `../race.js` (Task 1). Same worked examples as Task 3 — most of these are the reject-on-timeout shape (they reject with a "did not complete within Nms" error), matching Task 3's worked example 2.

- [ ] **Step: Apply the same transform to each file**

Same procedure as Task 3: read each file at its listed line numbers, replace the `Promise.race([realPromise, new Promise((_, reject) => setTimeout(() => reject(...), MS))])` shape with `raceWithTimeout(realPromise, MS, () => { throw ...; })`, add the import. `i1.ts` and `i5.ts` are two-sequential-worker-exception files (direct `Worker.create()`, not `withRunningWorker`) — this task only touches their internal `Promise.race` result-wait, not their worker management, which is unaffected by this plan (see Global Constraints).

- [ ] **Step: Run each touched file's own test**

Run: `npx vitest run src/engines/dynamic/checks/h1.test.ts src/engines/dynamic/checks/h3.test.ts src/engines/dynamic/checks/i1.test.ts src/engines/dynamic/checks/i3.test.ts src/engines/dynamic/checks/i4.test.ts src/engines/dynamic/checks/i5.test.ts src/engines/dynamic/checks/j1.test.ts src/engines/dynamic/checks/j2.test.ts src/engines/dynamic/checks/j3.test.ts src/engines/dynamic/checks/l1.test.ts`
Expected: PASS, same test counts as before this task.

- [ ] **Step: `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step: Confirm no bare leaking pattern remains anywhere in the codebase**

Run: `grep -rn "Promise.race(\[" src/engines/dynamic/checks/*.ts | grep -v '\.test\.ts'`
Expected: no output at all — every check file's `Promise.race([real, setTimeout...])` pattern is now routed through `raceWithTimeout`.

- [ ] **Step: Commit**

```bash
git add src/engines/dynamic/checks/h1.ts src/engines/dynamic/checks/h3.ts src/engines/dynamic/checks/i1.ts src/engines/dynamic/checks/i3.ts src/engines/dynamic/checks/i4.ts src/engines/dynamic/checks/i5.ts src/engines/dynamic/checks/j1.ts src/engines/dynamic/checks/j2.ts src/engines/dynamic/checks/j3.ts src/engines/dynamic/checks/l1.ts
git commit -m "Apply shared raceWithTimeout to h1/h3/i1/i3/i4/i5/j1/j2/j3/l1 — all 20 files done"
```

---

## Task 5: Verify Fix #1 closes the timer leak for real

**Files:** none (verification only)

- [ ] **Step 1: Full suite, run 1**

Run: `npx vitest run 2>&1 | tee /tmp/suite-run-1.log`
Expected: same pass count as the last confirmed baseline (230/230, 55 files) — this task doesn't add or remove tests. Check the tail of the log for `Unhandled Errors` / `Channel has been shut down` — expected: **absent** this time (was present in the pre-fix baseline).

- [ ] **Step 2: Full suite, run 2 (confirm it's actually gone, not just less frequent)**

Run: `npx vitest run 2>&1 | tee /tmp/suite-run-2.log`
Expected: same as step 1 — no `Channel has been shut down`, same pass count. Two consecutive clean runs is the bar CLAUDE.md's own diagnosis implies ("still reproduces... even with l2.ts fixed" was found by re-running, so a single clean run isn't enough evidence).

- [ ] **Step 3: Check for orphaned processes after both runs**

Run: `ps aux | grep -iE "temporal-sdk-typescript|ephemeral" | grep -v grep`
Expected: no output — no orphaned ephemeral-server processes left behind by either run.

- [ ] **Step 4: If either run still shows the error**

Do not proceed to Task 6. Grep for any remaining bare pattern (`grep -rn "Promise.race(\[" src/`, widen beyond `checks/` this time — check `src/engines/dynamic/*.ts` and `src/config/*.ts` too, in case the bug exists somewhere CLAUDE.md's list didn't cover), fix it following the same `raceWithTimeout` conversion, and re-run this task's steps 1-3 from the start.

- [ ] **Step 5: No commit for this task** — it's verification-only. Note the result in your task-tracking so Task 11's final verification can reference "confirmed clean at Task 5" as a checkpoint.

---

## Task 6: `raceWithSignal` + wire an `AbortController` through `runCheckWithGuards`

**Files:**
- Modify: `src/engines/dynamic/race.ts` (add `raceWithSignal`)
- Modify: `src/engines/dynamic/race.test.ts` (add its tests)
- Modify: `src/engines/dynamic/run-check.ts`

**Interfaces:**
- Produces: `raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort: () => T | PromiseLike<T>): Promise<T>` — Task 7/8 import this.
- Produces: `runCheckWithGuards`'s `fn` parameter changes from `() => Promise<TestResult>` to `(signal: AbortSignal) => Promise<TestResult>` — Task 9 updates `cli.ts`'s two call sites to match.

- [ ] **Step 1: Write the failing tests for `raceWithSignal`**

```typescript
// added to src/engines/dynamic/race.test.ts
import { raceWithSignal } from "./race.js";

describe("raceWithSignal", () => {
  it("resolves with the real promise's value when no signal is given", async () => {
    const result = await raceWithSignal(Promise.resolve("value"), undefined, () => "aborted");
    expect(result).toBe("value");
  });

  it("resolves with the real promise's value when the signal never fires", async () => {
    const controller = new AbortController();
    const result = await raceWithSignal(Promise.resolve("value"), controller.signal, () => "aborted");
    expect(result).toBe("value");
  });

  it("resolves with onAbort()'s value the moment the signal fires, even if the real promise never resolves", async () => {
    const controller = new AbortController();
    const real = new Promise<string>(() => {}); // never resolves — the exact shape of the reproduced bug
    const promise = raceWithSignal(real, controller.signal, () => "aborted value");
    controller.abort();
    const result = await promise;
    expect(result).toBe("aborted value");
  });

  it("resolves immediately with onAbort()'s value if the signal is already aborted before the call", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await raceWithSignal(new Promise<string>(() => {}), controller.signal, () => "already aborted");
    expect(result).toBe("already aborted");
  });

  it("removes its abort listener once the real promise wins, so a later abort() on the same controller is a no-op", async () => {
    const controller = new AbortController();
    const onAbort = vi.fn(() => "aborted");
    await raceWithSignal(Promise.resolve("value"), controller.signal, onAbort);
    controller.abort();
    expect(onAbort).not.toHaveBeenCalled();
  });
});
```

Add `vi` to the existing `import { describe, expect, it } from "vitest";` line at the top of `race.test.ts` (`import { describe, expect, it, vi } from "vitest";`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/engines/dynamic/race.test.ts`
Expected: FAIL — `raceWithSignal` is not exported from `race.ts` yet.

- [ ] **Step 3: Implement `raceWithSignal`**

```typescript
// added to src/engines/dynamic/race.ts

/**
 * Races `promise` against `signal` firing, resolving with `onAbort()`'s
 * value if the signal wins. Used to make an otherwise-unbounded wait (e.g.
 * `withRunningWorker`'s callback, which may itself be waiting on something
 * with no timeout of its own) settle promptly once `runCheckWithGuards`'s
 * timeout fires and calls `controller.abort()`, instead of staying
 * suspended forever with nothing left awaiting it. `signal` is optional so
 * every existing direct call site (tests, `bootWorker`) that doesn't pass
 * one keeps working unchanged.
 */
export function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => T | PromiseLike<T>,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(onAbort());

  let listener: () => void;
  const aborted = new Promise<T>((resolve) => {
    listener = () => resolve(onAbort());
    signal.addEventListener("abort", listener, { once: true });
  });

  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener("abort", listener));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engines/dynamic/race.test.ts`
Expected: PASS (8 tests total: 3 from Task 1 + 5 new).

- [ ] **Step 5: Wire `runCheckWithGuards` to create and abort the controller**

Read `src/engines/dynamic/run-check.ts` in full first (it's 55 lines, shown in full below for reference — this IS the current file). Replace it with:

```typescript
import { Engine, TestResult } from "../../report/types.js";

export const DEFAULT_CHECK_TIMEOUT_MS = 15_000;

export interface CheckMeta {
  id: string;
  category: string;
  name: string;
  target: string | null;
  engine: Engine;
}

/**
 * The ONE place per-check timeout and unhandled-error/timeout-to-ERRORED
 * conversion live — a shared orchestrator concern, not something each check
 * file re-implements. Wrap every check's execution in this before adding its
 * result to a report, so a hang or a bug inside one check can never block
 * the whole audit run or get misreported as a finding about the project
 * under test.
 *
 * `fn` receives an `AbortSignal` that fires the moment this timeout expires.
 * A check that owns a live worker (via `withRunningWorker`/
 * `withFaultInjectedWorker`, forwarding this same signal) uses it to shut
 * that worker down immediately on timeout, instead of leaving it registered
 * on its task queue for the rest of the audit run while `fn`'s own abandoned
 * promise sits forever unawaited — the exact scenario that produced a real
 * "Registration of multiple workers with overlapping worker task types"
 * error from the NEXT check sharing that queue (see CLAUDE.md's now-resolved
 * "Known gap" section for the original reproduction). This function itself
 * does not wait for `fn` to actually unwind after aborting it — `fn`'s
 * result (or continued hang) no longer matters once ERRORED has been
 * reported; what matters is that downstream, whatever `fn` was holding open
 * gets torn down as soon as the signal fires.
 */
export async function runCheckWithGuards(
  fn: (signal: AbortSignal) => Promise<TestResult>,
  meta: CheckMeta,
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<TestResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } catch (e) {
    const error = e as Error;
    const timedOut = /timed out after/.test(error.message);
    return {
      id: meta.id,
      category: meta.category,
      name: meta.name,
      target: meta.target,
      engine: meta.engine,
      status: "ERRORED",
      message: `Check ${meta.id} ${timedOut ? "timed out" : "threw an unhandled error"}: ${error.message}`,
      hint: timedOut
        ? "This check did not complete within its timeout. This could mean the check itself has a bug " +
          "(forgot to resolve, missing await), or it could mean the workflow/worker under test is genuinely " +
          "hung — investigate manually before trusting either PASS or FAIL results from this check."
        : "This is a bug in temporal-test-kit's check implementation, not a finding about the project under " +
          `test. Report it against src/engines/dynamic/checks/${meta.id.toLowerCase()}.ts.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
```

(The only real changes: `fn`'s type now takes `signal`, a `controller` is created up front, `controller.abort()` is called inside the existing `setTimeout` callback right before the reject, and `fn(controller.signal)` is what's raced instead of `fn()`. Everything else — the `ERRORED` shape, the timeout-message-detection regex, the `finally { clearTimeout(timer) }` — is unchanged.)

- [ ] **Step 6: Update `run-check.test.ts` (if it exists) or add one**

Run: `find src -iname "run-check.test.ts"`. If it exists, read it — its existing tests call `runCheckWithGuards(fn, meta)` with a zero-arg `fn`; since `signal` is a parameter `fn` receives but existing test fakes can simply ignore, those tests keep passing unchanged (a function declared as `() => Promise<TestResult>` structurally satisfies a variable of type `(signal: AbortSignal) => Promise<TestResult>` — TypeScript permits assigning a function with fewer declared parameters). Add one new test proving the signal actually fires on timeout:

```typescript
it("aborts the signal passed to fn when the check times out", async () => {
  let capturedSignal: AbortSignal | undefined;
  const result = await runCheckWithGuards(
    (signal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves
    },
    { id: "X1", category: "test", name: "test check", target: null, engine: "dynamic-zero-fixture" },
    50,
  );
  expect(result.status).toBe("ERRORED");
  expect(capturedSignal?.aborted).toBe(true);
});
```

If `run-check.test.ts` doesn't exist yet, create it with just this one test plus a baseline "reports ERRORED on timeout" / "reports ERRORED on thrown error" pair mirroring the two branches `runCheckWithGuards` already handles (read `run-check.ts`'s current behavior to write these — they're regression coverage for behavior that already exists, not new behavior).

- [ ] **Step 7: Run the test**

Run: `npx vitest run src/engines/dynamic/run-check.test.ts`
Expected: PASS.

- [ ] **Step 8: `npx tsc --noEmit`**

Expected: **will show errors** at this point — `cli.ts`'s two `runCheckWithGuards` call sites still pass zero-arg arrow functions (`() => fn(env, {...})`), which no longer type-check against the new `(signal: AbortSignal) => Promise<TestResult>` parameter type (a function needs to be able to receive an argument passed to it, and while TS allows *fewer* declared params, `() => ...` still can't be called with the wrong semantics here — actually confirm this by running tsc: if it type-checks anyway, `cli.ts`'s wrapper arrows simply ignore the signal today, which is fine for now and Task 9 fixes it for real; if it errors, that's expected and Task 9 is the very next task that fixes it). Note whichever outcome occurs — either is fine to leave for one commit, since Task 9 immediately follows.

- [ ] **Step 9: Commit**

```bash
git add src/engines/dynamic/race.ts src/engines/dynamic/race.test.ts src/engines/dynamic/run-check.ts src/engines/dynamic/run-check.test.ts
git commit -m "Thread an AbortController through runCheckWithGuards, aborted on timeout"
```

---

## Task 7: Wire the signal through `withRunningWorker`

**Files:**
- Modify: `src/engines/dynamic/environment.ts`
- Modify: `src/engines/dynamic/environment.test.ts`

**Interfaces:**
- Consumes: `raceWithSignal` from `./race.js` (Task 6).
- Produces: `withRunningWorker<T>(env, target, fn, signal?: AbortSignal): Promise<T>` — every one of the 25 check files in Tasks 9-10 passes their received `signal` as this 4th argument.

- [ ] **Step 1: Write the failing test**

This is the direct regression test for the reproduced bug — proving the worker actually shuts down (releasing its task-queue registration) even though `fn` never returns, and that a second worker can immediately register on the same queue afterward without colliding:

```typescript
// added to src/engines/dynamic/environment.test.ts
import { withRunningWorker } from "./environment.js";

describe("withRunningWorker abort behavior", () => {
  it("shuts the worker down immediately when the signal aborts, even though fn never returns — and a fresh worker can then register on the same task queue without colliding", async () => {
    await withEphemeralEnvironment(async (env) => {
      const activities = await import(join(SAMPLE_PROJECT, "src", "activities.ts"));
      const target = {
        workflowsPath: join(SAMPLE_PROJECT, "src", "workflows.ts"),
        activities,
        taskQueue: "ttk-environment-test-abort",
      };
      const controller = new AbortController();

      const hangingCall = withRunningWorker(
        env,
        target,
        () => new Promise(() => {}), // never resolves — same shape as the reproduced C2 hang
        controller.signal,
      );

      controller.abort();

      // The call must settle (reject, since fn itself never resolved) promptly —
      // not hang forever. A generous but bounded wait proves this without a flaky race.
      await expect(
        Promise.race([
          hangingCall.then(
            () => "resolved",
            () => "rejected",
          ),
          new Promise((resolve) => setTimeout(() => resolve("still pending"), 5_000)),
        ]),
      ).resolves.not.toBe("still pending");

      // The real proof: a second worker on the SAME task queue registers cleanly.
      // Before this fix, this would throw "Registration of multiple workers with
      // overlapping worker task types" because the first worker was still live.
      const result = await bootWorker(env, target);
      expect(result.booted).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/engines/dynamic/environment.test.ts`
Expected: FAIL — either a TypeScript error (4th `signal` argument doesn't exist on `withRunningWorker` yet) or, if it somehow compiles, a timeout/hang or the `overlapping worker task types` error.

- [ ] **Step 3: Implement the abort path in `withRunningWorker`**

Current `withRunningWorker` (`environment.ts` lines 79-103):

```typescript
export async function withRunningWorker<T>(
  env: EphemeralEnvironment,
  target: WorkerTarget,
  fn: (worker: Worker) => Promise<T>,
): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: target.taskQueue,
    workflowsPath: target.workflowsPath,
    activities: target.activities,
  });

  const runPromise = worker.run();
  runPromise.catch(() => {
    // Errors surface via the awaited runPromise below; this just prevents
    // an unhandled rejection while `fn` is still running.
  });

  try {
    return await fn(worker);
  } finally {
    worker.shutdown();
    await runPromise;
  }
}
```

Replace with:

```typescript
export async function withRunningWorker<T>(
  env: EphemeralEnvironment,
  target: WorkerTarget,
  fn: (worker: Worker) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: target.taskQueue,
    workflowsPath: target.workflowsPath,
    activities: target.activities,
  });

  const runPromise = worker.run();
  runPromise.catch(() => {
    // Errors surface via the awaited runPromise below; this just prevents
    // an unhandled rejection while `fn` is still running.
  });

  let shutdown = false;
  const shutdownOnce = async () => {
    if (shutdown) return;
    shutdown = true;
    worker.shutdown();
    await runPromise;
  };

  try {
    return await raceWithSignal(fn(worker), signal, async () => {
      // The caller (runCheckWithGuards) has already timed out and reported
      // ERRORED — fn's own promise is abandoned here (same abandon-and-move-on
      // pattern already used for runPromise above), but the worker itself must
      // still shut down for real: this is what releases its task-queue
      // registration so the NEXT check sharing this queue doesn't collide with
      // it. See CLAUDE.md's now-resolved "Known gap" section for what this
      // fixes.
      await shutdownOnce();
      throw new Error("withRunningWorker: aborted (check timed out) — worker was shut down without waiting for its own callback to finish.");
    });
  } finally {
    await shutdownOnce();
  }
}
```

Add `import { raceWithSignal } from "./race.js";` near the top of `environment.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/engines/dynamic/environment.test.ts`
Expected: PASS, including the new abort test. This test can take a few seconds (real ephemeral environment boot) — that's expected, not a hang.

- [ ] **Step 5: Run the existing `bootWorker` test too, to confirm no regression**

Run: `npx vitest run src/engines/dynamic/environment.test.ts -t "bootWorker"`
Expected: PASS — `bootWorker` calls `withRunningWorker` with no 4th argument, which must still work exactly as before (optional parameter, `raceWithSignal` short-circuits to the plain promise when `signal` is `undefined`).

- [ ] **Step 6: `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/engines/dynamic/environment.ts src/engines/dynamic/environment.test.ts
git commit -m "withRunningWorker: shut the worker down immediately on abort, not just report ERRORED"
```

---

## Task 8: Wire the signal through `withFaultInjectedWorker`

**Files:**
- Modify: `src/engines/dynamic/fault-injection.ts`
- Modify: `src/engines/dynamic/fault-injection.test.ts`

**Interfaces:**
- Consumes: `raceWithSignal` from `./race.js` (Task 6).
- Produces: `withFaultInjectedWorker<T>(env, target, faultActivityName, replacement, fn, signal?: AbortSignal): Promise<T>` — `b3.ts`, `f1.ts`, `g1.ts`, `l2.ts` (Task 9) pass their received `signal` as this 6th argument.

- [ ] **Step 1: Read `fault-injection.test.ts` in full first** (121 lines) to match its existing test style/fixtures before adding to it.

- [ ] **Step 2: Write the failing test**

Same shape as Task 7's, adapted to this function's extra `faultActivityName`/`replacement` parameters — read the existing tests in the file to find the exact sample-project activity name and taskQueue convention they already use, and mirror it. The test body itself:

```typescript
it("shuts the worker down immediately when the signal aborts, even though fn never returns", async () => {
  // ... use this file's existing withEphemeralEnvironment/target/activity setup ...
  const controller = new AbortController();

  const hangingCall = withFaultInjectedWorker(
    env,
    target,
    existingFaultActivityName, // whatever this file's existing tests already use
    existingReplacement,
    () => new Promise(() => {}),
    controller.signal,
  );

  controller.abort();

  await expect(
    Promise.race([
      hangingCall.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 5_000)),
    ]),
  ).resolves.not.toBe("still pending");

  const result = await bootWorker(env, target); // same taskQueue as `target`
  expect(result.booted).toBe(true);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/engines/dynamic/fault-injection.test.ts`
Expected: FAIL (same reasons as Task 7 step 2).

- [ ] **Step 4: Implement the abort path**

Current `withFaultInjectedWorker` already has the exact `shutdownOnce`/`registerCleanup` shape (shown in full in the investigation above) — apply the identical transform Task 7 applied to `withRunningWorker`:

```typescript
export async function withFaultInjectedWorker<T>(
  env: EphemeralEnvironment,
  target: WorkerTarget,
  faultActivityName: string,
  replacement: (...args: unknown[]) => unknown,
  fn: (worker: Worker) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!(faultActivityName in target.activities)) {
    throw new Error(
      `withFaultInjectedWorker: "${faultActivityName}" is not an exported activity in this project's activities module`,
    );
  }

  const activities = { ...target.activities, [faultActivityName]: replacement };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: target.taskQueue,
    workflowsPath: target.workflowsPath,
    activities,
  });

  const runPromise = worker.run();
  runPromise.catch(() => {
    // Errors surface via the awaited runPromise below; this just prevents
    // an unhandled rejection while `fn` is still running.
  });

  let shutdown = false;
  const shutdownOnce = async () => {
    if (shutdown) return;
    shutdown = true;
    worker.shutdown();
    await runPromise;
  };
  const unregister = registerCleanup(shutdownOnce);

  try {
    return await raceWithSignal(fn(worker), signal, async () => {
      await shutdownOnce();
      throw new Error("withFaultInjectedWorker: aborted (check timed out) — worker was shut down without waiting for its own callback to finish.");
    });
  } finally {
    unregister();
    await shutdownOnce();
  }
}
```

(Same change pattern as Task 7: add the `signal` parameter, add `shutdownOnce`'s use inside a `raceWithSignal`-wrapped call instead of a bare `await fn(worker)`. The existing `registerCleanup`/`unregister` interrupt-safety plumbing is untouched.)

Add `import { raceWithSignal } from "./race.js";` near the top.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/engines/dynamic/fault-injection.test.ts`
Expected: PASS, including the new test and every pre-existing one.

- [ ] **Step 6: `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/engines/dynamic/fault-injection.ts src/engines/dynamic/fault-injection.test.ts
git commit -m "withFaultInjectedWorker: shut the worker down immediately on abort, matching withRunningWorker"
```

---

## Task 9: Thread `signal` through the 25 checks calling `withRunningWorker`/`withFaultInjectedWorker` — batch A

**Files:** (all under `src/engines/dynamic/checks/`)
- Modify: `a1.ts`, `a3.ts`, `a4.ts`, `b3.ts`, `b4.ts`, `b5.ts`, `c1.ts`, `c2.ts`, `c3.ts`, `c4.ts`, `c5.ts`, `e1.ts`, `e2.ts`

**Interfaces:**
- Consumes: `withRunningWorker`/`withFaultInjectedWorker`'s new optional `signal` parameter (Tasks 7-8).
- Produces: each check function in this list gains a trailing `signal?: AbortSignal` parameter and forwards it into its `withRunningWorker(...)`/`withFaultInjectedWorker(...)` call.

For each file: add `signal?: AbortSignal` as the last parameter of the exported check function, and add `signal` as the last argument to that file's `withRunningWorker(...)`/`withFaultInjectedWorker(...)` call (found at the line numbers recorded during investigation: `a1.ts:42`, `a3.ts:32`, `a4.ts:51`, `b3.ts:96`, `b4.ts:177`, `b5.ts:51`, `c1.ts:49`, `c2.ts:38`, `c3.ts:44`, `c4.ts:43`, `c5.ts:49`, `e1.ts:57`, `e2.ts:139`).

Worked example — `a1.ts`:

Current signature (line 28-31):

```typescript
export async function checkA1WorkflowStarts(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
): Promise<TestResult> {
```

Replace with:

```typescript
export async function checkA1WorkflowStarts(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
): Promise<TestResult> {
```

Current call site (line 42):

```typescript
  return withRunningWorker(env, target, async () => {
```

Replace with:

```typescript
  return withRunningWorker(
    env,
    target,
    async () => {
```

...and its matching closing `});` becomes `}, signal);` (i.e. add `signal` as the 4th argument to the same call — reformat only as needed to keep the line readable; the minimal version is simply appending `, signal` right before the closing `)` of the `withRunningWorker(...)` call).

Apply the same two edits (signature + call-site argument) to the remaining 12 files in this batch. `b3.ts` and `e2.ts` (wait — `e2.ts` calls `withRunningWorker`, not `withFaultInjectedWorker`; `b3.ts` calls `withFaultInjectedWorker`) — for `b3.ts` specifically, the call is `withFaultInjectedWorker(env, target, activityName, forceRetryOnce, async () => {...})` (line 96) — append `signal` as the 6th argument, matching Task 8's new signature.

- [ ] **Step: Run each touched file's own test**

Run: `npx vitest run src/engines/dynamic/checks/a1.test.ts src/engines/dynamic/checks/a3.test.ts src/engines/dynamic/checks/a4.test.ts src/engines/dynamic/checks/b3.test.ts src/engines/dynamic/checks/b4.test.ts src/engines/dynamic/checks/b5.test.ts src/engines/dynamic/checks/c1.test.ts src/engines/dynamic/checks/c2.test.ts src/engines/dynamic/checks/c3.test.ts src/engines/dynamic/checks/c4.test.ts src/engines/dynamic/checks/c5.test.ts src/engines/dynamic/checks/e1.test.ts src/engines/dynamic/checks/e2.test.ts`
Expected: PASS, same counts as before (existing tests call these functions without a `signal` argument — still valid, since it's optional and trailing).

- [ ] **Step: `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step: Commit**

```bash
git add src/engines/dynamic/checks/a1.ts src/engines/dynamic/checks/a3.ts src/engines/dynamic/checks/a4.ts src/engines/dynamic/checks/b3.ts src/engines/dynamic/checks/b4.ts src/engines/dynamic/checks/b5.ts src/engines/dynamic/checks/c1.ts src/engines/dynamic/checks/c2.ts src/engines/dynamic/checks/c3.ts src/engines/dynamic/checks/c4.ts src/engines/dynamic/checks/c5.ts src/engines/dynamic/checks/e1.ts src/engines/dynamic/checks/e2.ts
git commit -m "Thread abort signal through a1-e2 batch's withRunningWorker/withFaultInjectedWorker calls"
```

---

## Task 10: Thread `signal` through the remaining 12 checks — batch B, plus the type definitions and `cli.ts` wiring

**Files:**
- Modify: `f1.ts`, `f2.ts`, `g1.ts`, `h1.ts`, `h2.ts`, `h3.ts`, `i3.ts`, `i4.ts`, `j1.ts`, `j3.ts`, `k2.ts`, `l2.ts` (all under `src/engines/dynamic/checks/`)
- Modify: `src/engines/dynamic/fixture-check.ts` (`DynamicFixtureCheckFn` type)
- Modify: `src/cli.ts` (the `ZeroFixtureCheckFn` type at line 104-107, and both `runCheckWithGuards` call sites at lines 151 and 250)

**Interfaces:**
- Consumes: everything from Tasks 6-9.
- Produces: the full signal path is complete end-to-end after this task — `runCheckWithGuards` → each check → `withRunningWorker`/`withFaultInjectedWorker`.

- [ ] **Step 1: Apply the same signature + call-site edit as Task 9 to the remaining 12 files**

Line numbers from investigation: `f1.ts:68` (withRunningWorker) and `f1.ts:136` (withFaultInjectedWorker — f1 calls both, forward the same `signal` to each), `f2.ts:80`, `g1.ts:55` (withFaultInjectedWorker), `h1.ts:47`, `h2.ts:102`, `h3.ts:70`, `i3.ts:31`, `i4.ts:29`, `j1.ts:65`, `j3.ts:92`, `k2.ts:189`, `l2.ts:118` (withFaultInjectedWorker).

- [ ] **Step 2: Update `DynamicFixtureCheckFn`**

Current (`src/engines/dynamic/fixture-check.ts`):

```typescript
export type DynamicFixtureCheckFn = (
  env: EphemeralEnvironment,
  target: DynamicFixtureTarget,
  features: FeaturesConfig,
) => Promise<TestResult>;
```

Replace with:

```typescript
export type DynamicFixtureCheckFn = (
  env: EphemeralEnvironment,
  target: DynamicFixtureTarget,
  features: FeaturesConfig,
  signal?: AbortSignal,
) => Promise<TestResult>;
```

- [ ] **Step 3: Update `cli.ts`'s `ZeroFixtureCheckFn` type**

Current (lines 104-107):

```typescript
type ZeroFixtureCheckFn = (
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
) => Promise<TestResult>;
```

Replace with:

```typescript
type ZeroFixtureCheckFn = (
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
) => Promise<TestResult>;
```

- [ ] **Step 4: Wire the zero-fixture `runCheckWithGuards` call site**

Current (lines 151-168):

```typescript
        await runCheckWithGuards(
          () =>
            fn(env, {
              workflowType: workflow.type,
              taskQueue: workflow.taskQueue,
              workflowsPath,
              activities,
            }),
          {
            id: entry.id,
            category: entry.category,
            name: entry.name,
            target: workflow.type,
            engine: "dynamic-zero-fixture",
          },
          timeoutMs,
        ),
```

Replace with:

```typescript
        await runCheckWithGuards(
          (signal) =>
            fn(
              env,
              {
                workflowType: workflow.type,
                taskQueue: workflow.taskQueue,
                workflowsPath,
                activities,
              },
              signal,
            ),
          {
            id: entry.id,
            category: entry.category,
            name: entry.name,
            target: workflow.type,
            engine: "dynamic-zero-fixture",
          },
          timeoutMs,
        ),
```

- [ ] **Step 5: Wire the fixture `runCheckWithGuards` call site**

Current (lines 250-260):

```typescript
        await runCheckWithGuards(
          () => fn(env, { ...workflow, workflowsPath, activities }, features),
          {
            id: entry.id,
            category: entry.category,
            name: entry.name,
            target: workflow.type,
            engine: "dynamic-fixture",
          },
          timeoutMs,
        ),
```

Replace with:

```typescript
        await runCheckWithGuards(
          (signal) => fn(env, { ...workflow, workflowsPath, activities }, features, signal),
          {
            id: entry.id,
            category: entry.category,
            name: entry.name,
            target: workflow.type,
            engine: "dynamic-fixture",
          },
          timeoutMs,
        ),
```

- [ ] **Step 6: Run every dynamic-check test**

Run: `npx vitest run src/engines/dynamic/`
Expected: PASS, same pass count as Task 5's baseline (this task changes wiring/types, not check behavior).

- [ ] **Step 7: `npx tsc --noEmit`**

Expected: clean — this is the point where the full signal path type-checks end to end for the first time. If any of the 25 files from Tasks 9-10 has a lingering arity mismatch, this is where it surfaces; fix inline before moving on.

- [ ] **Step 8: Full suite**

Run: `npx vitest run`
Expected: 230/230 passing (or whatever the exact count is after Task 1's new `race.test.ts` and Task 6's `run-check.test.ts` — recompute the expected count as "Task 5's baseline count + new tests added in Tasks 1, 6, 7, 8").

- [ ] **Step 9: Commit**

```bash
git add src/engines/dynamic/checks/f1.ts src/engines/dynamic/checks/f2.ts src/engines/dynamic/checks/g1.ts src/engines/dynamic/checks/h1.ts src/engines/dynamic/checks/h2.ts src/engines/dynamic/checks/h3.ts src/engines/dynamic/checks/i3.ts src/engines/dynamic/checks/i4.ts src/engines/dynamic/checks/j1.ts src/engines/dynamic/checks/j3.ts src/engines/dynamic/checks/k2.ts src/engines/dynamic/checks/l2.ts src/engines/dynamic/fixture-check.ts src/cli.ts
git commit -m "Complete the abort-signal path: cli.ts creates it, all 25 worker-owning checks forward it"
```

---

## Task 11: Re-run the real repro, tighten and possibly relocate `cli-init-audit.e2e.test.ts`, full final verification

**Files:**
- Modify: `src/cli-init-audit.e2e.test.ts`
- Possibly modify: `vitest.config.ts`, `vitest.e2e.config.ts`, `package.json` (only if step 3 below confirms the test is fast now)
- Modify: `CLAUDE.md` (mark both sections resolved)

- [ ] **Step 1: Re-run the exact repro manually first, outside the test suite, to see real timing**

```bash
rm -rf examples/.tmp-manual-repro && mkdir -p examples/.tmp-manual-repro
cp -r examples/sample-project/. examples/.tmp-manual-repro/ --exclude=node_modules 2>/dev/null || cp -r examples/sample-project examples/.tmp-manual-repro-src && rsync -a --exclude node_modules examples/sample-project/ examples/.tmp-manual-repro/
ln -s "$(pwd)/examples/sample-project/node_modules" examples/.tmp-manual-repro/node_modules
rm -f examples/.tmp-manual-repro/temporal-test-kit.config.json
cd examples/.tmp-manual-repro
time node --import tsx ../../src/cli.ts init
time node --import tsx ../../src/cli.ts audit
cd ../..
rm -rf examples/.tmp-manual-repro
```

(Adjust the copy step to whatever actually works on this machine — the point is: real `init` then real `audit`, zero edits, same as the documented repro.) Watch the `audit` run's wall-clock time and its output for the `OrderWorkflow`-querying check(s) — with the fix, a hung check should report `ERRORED` and the run should move on within roughly `timeoutMs` (15s, or 30s for checks with an overridden budget) per hung check, not longer, and no later check should fail with `Registration of multiple workers with overlapping worker task types`.

- [ ] **Step 2: Confirm the specific collision is gone**

Run: `grep -c "overlapping worker task types" <(node --import tsx src/cli.ts audit 2>&1)` against a fresh copy of the same scenario (or reuse the output captured in Step 1).
Expected: `0`.

- [ ] **Step 3: Time the existing e2e test and decide whether to relocate it**

Run: `time npx vitest run --config vitest.e2e.config.ts`
Expected: since the timeout no longer waits out abandoned checks' full duration before the worker frees its queue, total time should drop substantially from the ~4.5 minutes documented in `fc13ee4`. Compare against the file's own `330_000`ms (5.5 min) test timeout and the `300_000`ms `runCli(dir, ["audit"], 300_000)` budget inside it.

  - If the run now completes in **under a few seconds to low tens of seconds**: tighten both budgets in `cli-init-audit.e2e.test.ts` (e.g. the `audit` call's timeout down to something like `30_000`ms and the test's own timeout down to `40_000`ms — pick values with headroom over the actual observed time from Step 1/3, not the smallest number that happens to pass once), update the test's own comments (lines 90-94, which currently say "Generous budget: this run deliberately hits the known, documented runCheckWithGuards cancellation gap" — rewrite to reflect that the gap is now fixed and the run is fast), change `expect([0, 1]).toContain(auditResult.code)` (line 102) to `expect(auditResult.code).toBe(0)` (the trailing-crash tolerance existed specifically for the now-fixed timer-leak bug), and move the file itself: rename `src/cli-init-audit.e2e.test.ts` to `src/cli-init-audit.test.ts` (dropping `.e2e.`) so it's picked up by the default `vitest.config.ts` `include` pattern automatically (`src/**/*.test.ts`) and excluded from `vitest.e2e.config.ts` (`src/**/*.e2e.test.ts`) automatically — no config file edits needed, the rename alone does it. Update the file's own doc comment (lines 42-68) to describe the corrected, fast, non-hanging behavior instead of documenting the known gap.
  - If it's still slow (multiple minutes): leave it in `vitest.e2e.config.ts` under its current name, but still update lines 60-68's comment (the paragraph describing the "known, documented... cancellation gap") since that gap is now fixed — investigate what's still slow (a genuinely long-running check like D2/D3/D4's real-time schedule waits are expected to still take real wall-clock time; that's not a bug) and note the real cause in the comment instead of attributing it to the now-fixed gap.

- [ ] **Step 4: Run the (possibly renamed) test**

Run: `npx vitest run src/cli-init-audit.test.ts` (or `--config vitest.e2e.config.ts` if it stayed there)
Expected: PASS, with the tightened exit-code and timing assertions from Step 3.

- [ ] **Step 5: `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step 6: Full suite, twice more, with the (possibly relocated) test now included in the default run**

Run: `npx vitest run` (twice, as in Task 5)
Expected: passes both times, no `Channel has been shut down`, and — if Step 3 relocated the file — the pass count includes its one test now that it's no longer excluded by `vitest.config.ts`.

- [ ] **Step 7: `ps aux` before/after, one more time, covering this heavier run**

```bash
ps aux | grep -iE "temporal-sdk-typescript|ephemeral" | grep -v grep  # before
npx vitest run
ps aux | grep -iE "temporal-sdk-typescript|ephemeral" | grep -v grep  # after
```
Expected: both empty.

- [ ] **Step 8: Real run via `dist/cli.js`**

```bash
npm run build
rm -rf examples/.tmp-dist-check && mkdir -p examples/.tmp-dist-check
rsync -a --exclude node_modules examples/sample-project/ examples/.tmp-dist-check/
ln -s "$(pwd)/examples/sample-project/node_modules" examples/.tmp-dist-check/node_modules
cd examples/.tmp-dist-check
node ../../dist/cli.js init
node ../../dist/cli.js audit
cd ../..
rm -rf examples/.tmp-dist-check
```
Expected: both commands exit 0, `audit`'s report is well-formed (same shape the e2e test already asserts: `STATIC: 5/5 passed`, `HTML report written to`, every catalog ID appears), no orphaned processes afterward (`ps aux` check again).

- [ ] **Step 9: Update `CLAUDE.md`**

Read the current "Per-check timeout and error isolation" section (line 307 onward, specifically the "### Known gap: the timeout doesn't actually cancel the hung check" subsection, lines 329-367) and the "Known follow-up cleanup: uncleared `Promise.race` timers" section (lines 383-449) in full. Replace both with short "how this was fixed" notes in the same voice/level of detail as the rest of the file — reference `src/engines/dynamic/race.ts` (`raceWithTimeout`/`raceWithSignal`), the `signal` parameter now threaded through `withRunningWorker`/`withFaultInjectedWorker`/`runCheckWithGuards`, and the `c2.ts` finding (the actual unbounded call behind the original reproduction, not one of the originally-listed 20 files). Do not just delete the sections — a future reader benefits from knowing this class of bug existed and how it was closed, same as this file's existing "Worker lifecycle gotcha" section documents a fixed-but-worth-knowing gotcha rather than silently omitting it.

- [ ] **Step 10: Commit**

```bash
git add src/cli-init-audit.test.ts CLAUDE.md vitest.config.ts vitest.e2e.config.ts package.json
git commit -m "Close both fc13ee4 follow-ups: timer-leak cleanup verified, timeout now actually cancels hung checks"
```

(Adjust the `git add` file list to whatever Step 3 actually touched — if the e2e test stayed in place under its original name, `git add src/cli-init-audit.e2e.test.ts` instead, and drop the `vitest.*` / `package.json` entries if nothing there changed.)

---

## Self-Review Notes

- **Spec coverage:** User's 4 numbered requirements — (1) ordering/relation answered up front with the `c2.ts` finding as evidence, fix order follows from it (Tasks 1-5 before 6-10); (2) `raceWithTimeout` extraction + all 20 files covered (Tasks 1-4); (3) abort-based cancellation through `withRunningWorker`/`withFaultInjectedWorker`, reusing the existing create-run-shutdown-in-a-finally contract rather than inventing a new worker-teardown path (Tasks 6-10); (4) Worker lifecycle survival confirmed via Task 7/8's own new tests (which directly exercise the abort-then-reboot-on-same-queue path) plus Task 11's real CLI runs. Verification section — repro re-run (Task 11 steps 1-2), full suite x2 twice over (Tasks 5 and 11), tsc clean at every task, `ps aux` checks (Tasks 5, 11), real `dist/cli.js` run (Task 11 step 8), e2e test timing re-evaluated and relocated if fast (Task 11 step 3) — all covered.
- **Placeholder scan:** every task's code steps show real, file-specific before/after code (or, for the two 10-file mechanical batches, an explicit transformation rule plus two fully-worked examples covering both shapes that appear, plus exact file:line anchors for every remaining file) rather than "similar to Task N" hand-waving.
- **Type consistency:** `raceWithTimeout<T>(promise, ms, onTimeout)` and `raceWithSignal<T>(promise, signal, onAbort)` signatures are introduced once (Tasks 1, 6) and referenced identically everywhere after. `withRunningWorker`'s new trailing `signal?: AbortSignal` (Task 7) and `withFaultInjectedWorker`'s new trailing `signal?: AbortSignal` (Task 8, as its 6th parameter after `fn`) match what Tasks 9-10 pass. `runCheckWithGuards`'s `fn: (signal: AbortSignal) => Promise<TestResult>` (Task 6) matches the `(signal) => fn(...)` wrapper `cli.ts` builds in Task 10.
