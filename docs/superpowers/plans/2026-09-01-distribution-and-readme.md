# Distribution + README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `temporal-test-kit` actually usable by someone who isn't the person who built it — confirm and fix the real v1 distribution path (git-install), write the README a new user needs, and prove the spec's own acceptance bar ("works against a second, unrelated project with zero code changes to the tool") for real, against a genuinely separate project on disk.

**Architecture:** Three independent deliverables, done in dependency order: (1) fix a real gap in the distribution mechanism itself — discovered during this plan's own investigation, not assumed — before (2) documenting it in a README, before (3) proving both together end-to-end against a project this repository has never touched.

**Tech Stack:** npm's git-dependency install mechanism (`npm install git+<url>`, which runs the package's own `prepare` lifecycle script after cloning), TypeScript build (`tsc`), no new libraries.

**Spec:** `/home/technoidentity-com/Downloads/001temporal-test-kit-build-spec-FINAL.md` — Section 3 (package identity/distribution), Section 10 (acceptance criteria), Section 12 (the open question this plan answers: "Whether an internal npm registry already exists, or git-install is the real v1 distribution method").

## Global Constraints

- Distribution method is git-install (`npm install git+<url>`) — confirmed via investigation: no `.npmrc`, no `publishConfig`/`registry` field in `package.json`, and no evidence anywhere in this repo of an internal registry. Per spec Section 3, this is exactly the documented fallback for when "a registry doesn't exist yet."
- This repo has no git remote configured. Per your explicit direction: the README uses a placeholder URL (clearly marked, with a real-host example in a comment) rather than a fabricated real-looking one; the real end-to-end distribution test proves the git-install *mechanism* using a local `git+file://` URL against this repo, which npm treats identically to a real hosted URL (it still runs a real `git clone` and the real `prepare` lifecycle) — pushing to an actual host is a follow-up action for you, not something this plan does.
- The real acceptance test (Task 3) must run against a project that is not `examples/sample-project` and not nested inside this repo's own tree — a genuinely separate project on disk, per your explicit instruction.
- Don't touch Phase 5 (`--interactive`) — explicitly out of scope per your last message.

---

## File Structure

New/modified in `temporal-test-kit`:
- Modify: `package.json` — add a `prepare` script (the actual gap this plan found and fixes).
- Create: `README.md` — the deliverable a new user needs.

New, outside `temporal-test-kit` entirely (the acceptance-test project):
- Create: `~/Documents/temporal_testing/acceptance-check-project/` — a minimal, genuinely independent Temporal TypeScript project (its own `package.json`, one workflow distinct from `sample-project`'s `GreetingWorkflow`, one activity, a worker entry point) used only to prove Task 3's acceptance bar. Not part of `temporal-test-kit`'s own git history.

---

## Task 1: Fix the git-install gap (`prepare` script) and prove it mechanically

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: a working `npm install git+file://<path-to-this-repo>` install path, verified by Steps 3-5 below, that Task 3 depends on.

### The gap, found during this plan's investigation

`bin/temporal-test-kit.js` (already committed, already correct) does:
```js
#!/usr/bin/env node
import "../dist/cli.js";
```
But `dist/` is gitignored (correctly — it's a build artifact) and `package.json` currently has no `prepare` script — only `build`. A plain `npm install git+<url>` clones the repo's committed files (source, no `dist/`) and, without a `prepare` script, stops there: `dist/cli.js` never gets built, so the installed package's own `bin` entry point would fail immediately with `Cannot find module '../dist/cli.js'`. npm's `prepare` lifecycle script is specifically the mechanism it runs after cloning a git dependency (before the package is considered installed) — this is the standard, well-established pattern for exactly this situation (a TypeScript package installed from git needs its own build step to run automatically). Confirmed real by testing it in Step 3 below, not assumed.

- [ ] **Step 1: Confirm current (broken) behavior before fixing anything**

```bash
cd /tmp && rm -rf ttk-prepare-check && mkdir ttk-prepare-check && cd ttk-prepare-check
npm init -y >/dev/null
npm install "git+file://$(cd ~/Documents/temporal_testing/temporal-test-kit && git rev-parse --show-toplevel)" 2>&1 | tail -20
ls node_modules/temporal-test-kit/dist 2>&1
```

Expected: the install either fails outright, or succeeds but `node_modules/temporal-test-kit/dist` does not exist (confirming the gap — no build ran).

- [ ] **Step 2: Add the `prepare` script**

In `~/Documents/temporal_testing/temporal-test-kit/package.json`, in the `"scripts"` block, add:

```json
"prepare": "npm run build",
```

Placed alongside the existing `"build"` entry (order in the JSON object doesn't matter functionally, but put it right after `"build"` for readability):

```json
  "scripts": {
    "prepare": "npm run build",
    "build": "tsc && npm run copy-fixtures",
    "copy-fixtures": "mkdir -p dist/engines/dynamic/checks/fixtures && cp src/engines/dynamic/checks/fixtures/*.ts dist/engines/dynamic/checks/fixtures/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
  },
```

- [ ] **Step 3: Commit this fix**

```bash
cd ~/Documents/temporal_testing/temporal-test-kit
git add package.json
git commit -m "Add a prepare script so git-install actually builds dist/ (the real v1 distribution path)"
```

- [ ] **Step 4: Re-run the same install check, now against the fixed commit, and confirm it actually works**

```bash
cd /tmp && rm -rf ttk-prepare-check && mkdir ttk-prepare-check && cd ttk-prepare-check
npm init -y >/dev/null
npm install "git+file://$(cd ~/Documents/temporal_testing/temporal-test-kit && git rev-parse --show-toplevel)" 2>&1 | tail -30
ls node_modules/temporal-test-kit/dist/cli.js
node node_modules/.bin/temporal-test-kit 2>&1 | head -10
```

Expected: install succeeds, `dist/cli.js` exists inside `node_modules/temporal-test-kit/`, and running the installed `temporal-test-kit` binary with no arguments prints the usage text (`Usage: temporal-test-kit <command>`), proving the installed package is actually runnable — not just installed.

- [ ] **Step 5: Clean up the throwaway check**

```bash
rm -rf /tmp/ttk-prepare-check
```

No further commit needed — Step 3 already committed the real fix; this was just its own verification, kept separate from Task 3's fuller acceptance test.

---

## Task 2: Write `README.md`

**Files:**
- Create: `~/Documents/temporal_testing/temporal-test-kit/README.md`

**Interfaces:**
- Consumes: the `prepare` fix from Task 1 (the install instructions this README gives must actually work — Task 3 proves the whole README's instructions end-to-end, not just this file's prose).

- [ ] **Step 1: Read the exact CLI surface and result-status semantics this README must describe accurately, rather than from memory**

Already confirmed during this plan's investigation (re-confirm by reading if anything's changed since):
- `src/cli.ts`'s `usage()` function (around line 60) — the exact three commands (`init`, `run`, `audit`) and the `audit --list` flag.
- `src/report/types.ts`'s `Status` type (line 12) — the six statuses: `PASS`, `FAIL`, `SKIPPED`, `N_A`, `NOT_COVERED`, and `ERRORED` (a deliberate addition beyond the spec's original five, for a check that threw a bug in the tool itself rather than found a real problem — see that file's own comment for the full reasoning to summarize accurately, not copy verbatim).
- `docs/index.md` if it exists (check `find ~/Documents/temporal_testing/temporal-test-kit/docs -iname "index.md"`) for any existing project-level documentation conventions to match; if it doesn't exist, no cross-referencing needed.

- [ ] **Step 2: Write the README**

```markdown
# temporal-test-kit

A project-independent Temporal best-practices auditor for TypeScript. Install
it into any Temporal-based project, describe that project's workflows in a
small config file, run one command, get a report of what does and doesn't
follow Temporal best practices — no changes to your project's code, ever.

This is the same category of tool as ESLint or a security scanner: it reports
problems, it does not fix them, and it never touches your application code.

## Install

No internal npm registry exists yet for this package, so it installs
straight from git:

```bash
npm install --save-dev git+<your-internal-git-host>/temporal-test-kit.git
```

For example, if this repo ends up hosted on GitHub under an org:
```bash
npm install --save-dev git+https://github.com/<your-org>/temporal-test-kit.git
```
or on an internal GitLab over SSH:
```bash
npm install --save-dev git+ssh://git@gitlab.internal.example.com/<group>/temporal-test-kit.git
```

Installing from git runs this package's own build automatically (via its
`prepare` script) — you don't need to build it yourself.

**Before this package has a real git remote at all** (e.g. while it's still
only a local clone), you can also point directly at a local path the exact
same way:
```bash
npm install --save-dev git+file:///absolute/path/to/temporal-test-kit
```
or, for quick local iteration without even a local git URL:
```bash
npx tsx /absolute/path/to/temporal-test-kit/src/cli.ts audit
```

## Quickstart

From the root of the Temporal project you want to audit:

```bash
npx temporal-test-kit init
```

This writes a starter `temporal-test-kit.config.json` into your project,
with every field commented and explained inline — including one fully
worked example entry showing every field filled in, and one minimal entry
showing the bare minimum. Fill in as much or as little as you want: every
field you leave blank just means fewer checks run (see "Reading results"
below) — nothing errors out because a field is missing.

Then:

```bash
npx temporal-test-kit audit
```

This runs every check this tool can run against your project as configured
and writes both a console summary and an HTML report
(`temporal-test-kit-report/index.html`, openable directly in a browser, no
network access needed) to your project's directory.

You can re-run `audit` as many times as you like as you fill in more of the
config — each additional field you fill in unlocks more checks without any
changes to the tool itself.

To see, at a glance, which checks are already covered by your current
config, which ones need more config, which don't apply to your project, and
which this tool can't run locally at all — without actually running
anything:

```bash
npx temporal-test-kit audit --list
```

This is also the fastest way to find which config field unlocks a specific
check you care about — every check's `--list` row names the exact config
field it's gated on (e.g. `workflows[].signals`, `features.childWorkflows`).

## Reading results

Every check reports exactly one of six statuses. They are never merged or
presented as equivalent — in particular, `SKIPPED` is never shown as a pass:

| Status | Meaning |
|---|---|
| `PASS` | The check ran and found no problem. |
| `FAIL` | The check ran and found a real problem — every `FAIL` includes a hint explaining why it matters and what to do about it. |
| `SKIPPED` | The check needs config data you haven't provided yet — the hint names the exact field. Fill it in and re-run `audit` to unlock it. |
| `N_A` | The check doesn't apply, because your project doesn't use that Temporal feature at all (e.g. a child-workflow check, when your config says `features.childWorkflows` is false/unset). |
| `NOT_COVERED` | The check requires real staging/multi-node/chaos infrastructure this local tool intentionally can't provide (e.g. load testing, multi-cluster failover) — always listed, never silently dropped. |
| `ERRORED` | The check itself hit a bug in temporal-test-kit — not a finding about your project. If you see this, please report it against the check named in the message. |

A missing config field always produces `SKIPPED` with a hint, never a false
`PASS` and never a crash.

## Commands

```
temporal-test-kit init            Generate a starter config in the current project.
temporal-test-kit run             Run only the fast, no-Temporal-server-needed static checks.
temporal-test-kit audit           Run everything: preflight + static + dynamic checks.
temporal-test-kit audit --list    Show every check's status (would-run / needs-fixture / N/A / not covered) without running anything.
```

## Requirements

Node.js 18+. No Temporal server needs to be running — `audit` boots its own
throwaway, in-memory Temporal test server for the duration of the run and
tears it down when it's done.
```

- [ ] **Step 2: Write the file**

Save the content above to `README.md` at the repo root.

- [ ] **Step 3: Proofread against the actual CLI**

Run each command the README documents against this repo itself (not yet installed anywhere — just via `tsx` locally) and confirm the README's description of its output matches reality:

```bash
cd ~/Documents/temporal_testing/temporal-test-kit
node --import tsx src/cli.ts 2>&1 | head -10          # matches "Commands" section?
node --import tsx src/cli.ts audit --list 2>&1 | head -20  # matches "--list" description?
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Add README: install, quickstart, result statuses, command reference"
```

---

## Task 3: Real acceptance test — install into a genuinely separate project and run `init` → `audit` end-to-end

**Files:**
- Create (outside `temporal-test-kit` entirely): `~/Documents/temporal_testing/acceptance-check-project/package.json`, `tsconfig.json`, `src/workflows.ts`, `src/activities.ts`, `src/worker.ts`

**Interfaces:**
- Consumes: the `prepare`-fixed git-install path from Task 1.
- Produces: a real, reproducible proof of spec Section 10's acceptance bar ("works against a second, unrelated project with zero code changes to the tool itself").

This is deliberately a **different, smaller** workflow than `examples/sample-project`'s `GreetingWorkflow` — reusing that same workflow shape would not actually prove project-independence, only that the tool works twice against the same code.

- [ ] **Step 1: Scaffold the acceptance-check project**

```bash
mkdir -p ~/Documents/temporal_testing/acceptance-check-project/src
cd ~/Documents/temporal_testing/acceptance-check-project
```

`package.json`:
```json
{
  "name": "acceptance-check-project",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "@temporalio/activity": "^1.23.0",
    "@temporalio/client": "^1.23.0",
    "@temporalio/worker": "^1.23.0",
    "@temporalio/workflow": "^1.23.0"
  },
  "devDependencies": {
    "@temporalio/testing": "^1.23.0",
    "typescript": "^5.6.0",
    "tsx": "^4.19.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`src/activities.ts`:
```typescript
export async function reverseTextActivity(input: string): Promise<string> {
  return input.split("").reverse().join("");
}
```

`src/workflows.ts`:
```typescript
import { proxyActivities, defineQuery, defineSignal, setHandler } from "@temporalio/workflow";
import type * as activities from "./activities.js";

const { reverseTextActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
});

export const getResultQuery = defineQuery<string | null>("getResult");
export const cancelSignal = defineSignal("cancel");

export async function TextReverserWorkflow(input: string): Promise<string> {
  let result: string | null = null;
  setHandler(getResultQuery, () => result);
  let cancelled = false;
  setHandler(cancelSignal, () => {
    cancelled = true;
  });
  if (cancelled) {
    return "cancelled before start";
  }
  result = await reverseTextActivity(input);
  return result;
}
```

`src/worker.ts`:
```typescript
import { Worker } from "@temporalio/worker";
import * as activities from "./activities.js";

async function main() {
  const worker = await Worker.create({
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
    taskQueue: "acceptance-check",
  });
  await worker.run();
}

main();
```

- [ ] **Step 2: Install this project's own real dependencies**

```bash
cd ~/Documents/temporal_testing/acceptance-check-project
npm install
```

Expected: succeeds (these are the same `@temporalio/*` versions `temporal-test-kit` itself already depends on, per its own `package.json`).

- [ ] **Step 3: Install `temporal-test-kit` via the real git-install path (local `git+file://`, per your direction — proves the mechanism identically to a real hosted URL)**

```bash
cd ~/Documents/temporal_testing/acceptance-check-project
npm install --save-dev "git+file://$(cd ~/Documents/temporal_testing/temporal-test-kit && git rev-parse --show-toplevel)"
ls node_modules/temporal-test-kit/dist/cli.js
```

Expected: install succeeds, `dist/cli.js` exists (the `prepare` fix from Task 1 running for real, against a project that has never touched `temporal-test-kit`'s source directly).

- [ ] **Step 4: `init`**

```bash
cd ~/Documents/temporal_testing/acceptance-check-project
npx temporal-test-kit init
cat temporal-test-kit.config.json
```

Expected: succeeds, writes a starter config, matches the README's description (worked example + minimal example entries).

- [ ] **Step 5: Fill in enough config to exercise real fixture-gated checks, not just the zero-fixture ones**

Edit `temporal-test-kit.config.json`'s `workflows[]` entry for `TextReverserWorkflow` (adjust the exact JSONC field names to match what `init` actually generated — read the file from Step 4 first):

```jsonc
{
  "workerEntryPoint": "src/worker.ts",
  "workflows": [
    {
      "type": "TextReverserWorkflow",
      "taskQueue": "acceptance-check",
      "sampleInput": "hello world",
      "queries": [{ "name": "getResult" }],
      "signals": [{ "name": "cancel" }]
    }
  ]
}
```

- [ ] **Step 6: `audit`**

```bash
cd ~/Documents/temporal_testing/acceptance-check-project
npx temporal-test-kit audit 2>&1 | tee /tmp/acceptance-audit.log
echo "EXIT: $?"
```

Expected: runs to completion, produces a well-formed report (`STATIC: 5/5 passed`, an `Overall:` summary line, `HTML report written to`), with the `queries`/`signals`-gated checks (e.g. C1, C2) now actually running (not `SKIPPED`) against `TextReverserWorkflow` — proof the fixture-unlocking mechanism works against a workflow `temporal-test-kit` has never seen before, with zero changes to `temporal-test-kit`'s own code.

- [ ] **Step 7: Confirm the HTML report is real and openable**

```bash
test -f ~/Documents/temporal_testing/acceptance-check-project/temporal-test-kit-report/index.html && echo "HTML report exists"
grep -c "TextReverserWorkflow" ~/Documents/temporal_testing/acceptance-check-project/temporal-test-kit-report/index.html
```

Expected: file exists, and the workflow name specific to THIS project appears in it — not `GreetingWorkflow` or anything from `examples/sample-project`, confirming the report is genuinely about this separate project.

- [ ] **Step 8: Check for orphaned processes**

```bash
ps aux | grep -iE "temporal-sdk-typescript|ephemeral" | grep -v grep
```

Expected: no output.

- [ ] **Step 9: Record the result — do NOT delete the acceptance-check project**

Unlike the plan's earlier temp-directory checks (Task 1's `/tmp/ttk-prepare-check`, which was a mechanical throwaway), leave
`~/Documents/temporal_testing/acceptance-check-project` in place after this task — it's the durable, inspectable proof this
plan set out to produce, not scratch work. Report its final location, the audit's summary line, and the confirmation from
Step 7 back to your human partner as the closing evidence for this plan.

- [ ] **Step 10: No commit needed inside `temporal-test-kit`'s own repo for this task** — nothing in `temporal-test-kit`'s
own tree changes here; this task's entire value is the acceptance-check project existing and having been proven to work.

---

## Self-Review Notes

- **Spec coverage:** requirement 1 (confirm distribution method) — answered with evidence (no registry infra found) and a real gap fixed (Task 1), not just asserted. Requirement 2 (README) — Task 2, covering install/quickstart/statuses/fixture-mapping pointer (`--list`) as asked. Requirement 3 (real cross-project test) — Task 3, a genuinely separate project outside this repo's tree, using a workflow distinct from `sample-project`'s, installed via the real git-install mechanism, fixture fields filled in to prove the "zero code changes to the tool" bar for real.
- **Placeholder scan:** every task has real, runnable commands and real file content (the acceptance project's actual source files are written out in full, not described).
- **Type consistency:** N/A — this plan introduces no new internal APIs; `TextReverserWorkflow`'s query/signal names (`getResult`/`cancel`) are used consistently between Task 3 Steps 1 and 5.
