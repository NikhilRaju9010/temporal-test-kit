# temporal-test-kit

A project-independent Temporal best-practices auditor for TypeScript. Install
it into any Temporal-based project, describe that project's workflows in a
small config file, run one command, get a report of what does and doesn't
follow Temporal best practices — no changes to your project's code, ever.

This is the same category of tool as ESLint or a security scanner: it reports
problems, it does not fix them, and it never touches your application code.

## Install

No internal npm registry exists yet for this package, so it installs
straight from git — installing from git runs this package's own build
automatically (via its `prepare` script), so you don't need to build it
yourself:

```bash
npm install --save-dev git+https://github.com/NikhilRaju9010/temporal-test-kit.git
```

**Without a real git remote at all** (e.g. working from a local clone before
it's pushed anywhere), you can point directly at a local path the exact same
way:
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
network access needed) to your project's directory. No Temporal server
needs to be running — `audit` boots its own throwaway, in-memory Temporal
test server for the duration of the run and tears it down when it's done.

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
check you care about — every check needing more config is listed as
`[needs fixture: <exact field name>]`, e.g. `[needs fixture:
workflows[].idempotencyTestActivity]`.

## Configuration

`init` writes `temporal-test-kit.config.json` in JSONC (JSON with `//`
comments) at your project root, with `project`/`workerEntryPoint`/
`taskQueues`/`workflows` already filled in for you — you won't normally
need to touch them. Everything else is optional fixture data that just
unlocks more checks when filled in.

Top-level shape:

```jsonc
{
  "project": "your-project-name",         // REQUIRED — any label; not validated against anything else
  "workerEntryPoint": "./src/worker.ts",  // REQUIRED — path to your real worker entry file, relative to this config file
  "taskQueues": ["default"],              // REQUIRED — array of strings; informational, not cross-checked against workflows[]

  "workflows": [ /* one entry per workflow you want audited — see below */ ],

  "features": { /* project-wide flags — see below */ },

  "outputDir": "./temporal-test-kit-report"
}
```

Each entry in `workflows[]` describes one real workflow in your project.
Only `type` and `taskQueue` are required — everything else is optional
fixture data that unlocks specific checks:

```jsonc
{
  // ---- REQUIRED ----
  "type": "MyWorkflow",        // must exactly match your exported workflow function's name
  "taskQueue": "my-queue",     // must match a task queue your worker actually listens on

  // ---- Everything below is optional; each comment names what it unlocks ----
  "sampleInput": { "id": "test-1" },       // A1 (happy path), A3 (duplicate-start), A4 (data round-trip)
  "isLongRunning": false,                   // E2 (Continue-As-New state preservation)
  "signals": [{ "name": "cancel", "payload": null }],   // C1, C5 — name must match a real setHandler() in your workflow
  "queries": [{ "name": "getStatus" }],                  // C2 — name must match a real setHandler() in your workflow
  "updates": [{ "name": "rename", "validInput": "x", "invalidInput": "" }], // C3, C4 (needs features.updates/updateWithStart)
  "sagaFailurePoint": "chargeCardActivity",  // G1 — name of an activity to force-fail
  "idempotencyTestActivity": "sendEmailActivity", // B3 — name of an activity to force a retry on
  "hasCleanupOnCancel": true,                // H1
  "hasChildWorkflows": false,                // F1, F2, H3 (needs features.childWorkflows)
  "sensitiveDataFields": ["cardNumber"],     // K2 — field names from sampleInput that must never appear in plain text
  "dependencyOutageTestActivity": "chargeCardActivity" // L2 — name of an activity to simulate an outage on
}
```

`features` are project-wide flags — leave each `false`/unset if you don't
use that Temporal feature at all (those checks report `N_A`, not
`SKIPPED`, since "doesn't apply" and "missing info" are different things):

```jsonc
"features": {
  "childWorkflows": false,
  "schedules": false,
  "scheduleWorkflowId": "MyWorkflow",   // required if schedules: true — names which workflows[] entry D2/D3/D4 test against
  "searchAttributes": false,
  "customSearchAttributeKeys": [],      // required if searchAttributes: true
  "updates": false,
  "updateWithStart": false,
  "customDataConverter": false
}
```

Run `temporal-test-kit audit --list` any time to see exactly which field
unlocks which check for your current config, without running anything.

### Avoiding common setup errors

Most first-run problems come from one of these — checking them up front
saves a full audit cycle:

- **`workerEntryPoint` must point to a real file that exists**, relative to
  where `temporal-test-kit.config.json` lives. `audit`'s preflight step
  checks this first and fails fast with a clear message if it's wrong,
  rather than running 21+ confusing, unrelated check failures.
- **`workflows[].type` must exactly match your exported workflow function's
  name** (the string Temporal actually starts), not a file name or a
  display label.
- **`workflows[].taskQueue` must match a task queue your worker is actually
  listening on** — a mismatch here means the check's workflow silently
  never gets picked up, reported as `still RUNNING` rather than a config
  error.
- **`signals[].name`/`queries[].name`/`updates[].name` must exactly match
  real `setHandler()` registrations** in your workflow code. A name that
  doesn't match isn't a crash — Temporal silently accepts a signal with no
  handler — but the corresponding check will honestly report it found no
  effect, which reads like a bug in your workflow if the name was actually
  just a typo.
- **`@temporalio/*` packages must already be installed in the project being
  audited** (this tool doesn't install them for you) — preflight checks
  this and tells you if something's missing.
- **Node.js 18+** — preflight checks this too.
- No Temporal server needs to be running yourself — `audit` boots its own
  throwaway one. If you see a port-related preflight failure, another
  process is likely already bound to the port it tried to use; re-running
  usually picks a different free one automatically.

None of the above are things `audit` will crash on if you get them wrong —
they either fail preflight with a clear message, or produce an honest
`FAIL`/`SKIPPED` result naming exactly what to fix. If you ever see
`ERRORED` (not `FAIL`), that's the one status that means the tool itself
hit a bug, not something in your config — see "Reading results" below.

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

Node.js 18+.
