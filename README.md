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

**Before this package has a real git remote at all** (e.g. while it's still
only a local clone), you can point directly at a local path the exact same
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
