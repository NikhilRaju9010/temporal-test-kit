import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "./catalog.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "examples", "sample-project");
const CLI_ENTRY = join(import.meta.dirname, "cli.ts");
// Nested INSIDE examples/, not the OS tmpdir: `--import tsx` (used both by
// this CLI invocation and, if the audit reaches I1, by its own
// spawnKillableWorker) resolves "tsx" by walking up parent directories from
// the spawned process's cwd looking for node_modules — a truly out-of-tree
// temp dir (e.g. os.tmpdir()) never finds temporal-test-kit's own
// node_modules/tsx this way (confirmed empirically earlier in this
// project's history), the exact same class of issue CLAUDE.md's
// "Spawning a real child-process worker" section documents for I1.
// Staying under examples/ keeps the existing walk-up working, same as
// examples/sample-project itself already relies on.
const E2E_TMP_ROOT = join(import.meta.dirname, "..", "examples", ".tmp-init-audit-e2e");

function runCli(cwd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI_ENTRY, ...args], { cwd });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stdout += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI did not exit within ${timeoutMs}ms. Output so far:\n${stdout}`));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * The real first-run experience: `init`, then `audit` with ZERO edits.
 *
 * Corrected expectation, found by actually running this rather than
 * assuming: `init`'s template ships a WORKED EXAMPLE (per the build spec's
 * own Appendix A — a filled-in first workflow entry demonstrating every
 * field, plus a genuinely minimal second entry), not a blank one. Run with
 * no edits against a REAL project whose code doesn't happen to define
 * "OrderWorkflow"/"NotifyUserWorkflow" (the template's placeholder names),
 * the report is NOT all-SKIPPED — the fields with example data produce
 * honest FAILs (that workflow/activity doesn't exist here), while the
 * genuinely-blank second entry's fields correctly report SKIPPED. That's
 * the real, correct behavior for this scenario: a coherent, complete
 * report — not a crash, not a hang, not a wall of confusing internal
 * errors — never the literal "all SKIPPED" shape a first assumption
 * suggested.
 *
 * This test locks in the "doesn't crash, produces a well-formed report"
 * guarantee. It deliberately does NOT assert zero orphaned in-process
 * workers — running init's template against a project with mismatched
 * workflow names is EXACTLY the scenario that surfaces the known,
 * documented (not-yet-fixed) runCheckWithGuards cancellation gap in
 * CLAUDE.md ("the timeout doesn't actually cancel the hung check"): a
 * check waiting on a query to a workflow that never started can hang past
 * its own timeout and leave a worker registered for the rest of THIS
 * audit run's process lifetime. That's a real, separately-tracked issue,
 * not something to paper over with a narrower test.
 */
describe("temporal-test-kit init + audit end-to-end (real first-run experience)", () => {
  it("init generates a loadable config, and audit against it (zero edits, real project code) produces a complete, well-formed report — not a crash, not a hang", async () => {
    rmSync(E2E_TMP_ROOT, { recursive: true, force: true });
    mkdirSync(E2E_TMP_ROOT, { recursive: true });
    const dir = mkdtempSync(join(E2E_TMP_ROOT, "run-"));
    try {
      cpSync(SAMPLE_PROJECT, dir, { recursive: true, filter: (src) => !src.includes("node_modules") });
      // Symlink node_modules instead of copying — sample-project's own
      // dependencies are large and copying them per test run would be slow
      // and wasteful; a symlink is enough for module resolution to work.
      if (existsSync(join(SAMPLE_PROJECT, "node_modules")) && !existsSync(join(dir, "node_modules"))) {
        symlinkSync(join(SAMPLE_PROJECT, "node_modules"), join(dir, "node_modules"), "dir");
      }
      rmSync(join(dir, "temporal-test-kit.config.json"), { force: true });
      rmSync(join(dir, "temporal-test-kit-report"), { recursive: true, force: true });

      const initResult = await runCli(dir, ["init"], 10_000);
      expect(initResult.code).toBe(0);
      expect(initResult.stdout).toMatch(/Wrote a starter/);

      // Generous budget: this run deliberately hits the known, documented
      // runCheckWithGuards cancellation gap (a check waiting on a query to
      // a workflow that never started — because the template's example
      // workflow types don't exist in sample-project's real code — hangs
      // out its full 15s timeout more than once across the check suite).
      const auditResult = await runCli(dir, ["audit"], 300_000);

      // The process must exit with a real, defined code — not crash with an
      // uncaught exception mid-run (a different, already-known/documented
      // issue affecting a later stage — see the Promise.race timer note in
      // CLAUDE.md — is a TRAILING crash after the report is fully written,
      // which this 0/1 check still correctly accepts).
      expect([0, 1]).toContain(auditResult.code);

      expect(auditResult.stdout).toMatch(/STATIC: 5\/5 passed/);
      expect(auditResult.stdout).toMatch(/HTML report written to/);

      // Every one of the 49 catalog checks appears somewhere in the
      // report — nothing silently dropped.
      for (const entry of CATALOG) {
        expect(
          auditResult.stdout,
          `catalog entry ${entry.id} (${entry.name}) never appeared in the report`,
        ).toMatch(new RegExp(`\\] ${entry.id} `));
      }

      // The genuinely-blank second workflow entry (NotifyUserWorkflow) has
      // no fixture data at all — every fixture-gated check must report
      // SKIPPED for it specifically, proving "zero edits" degrades cleanly
      // rather than erroring for the fields nobody filled in.
      expect(auditResult.stdout).toMatch(/Skipped — workflows\[\]\.idempotencyTestActivity is not set in config/);
    } finally {
      rmSync(E2E_TMP_ROOT, { recursive: true, force: true });
    }
  }, 330_000);
});
