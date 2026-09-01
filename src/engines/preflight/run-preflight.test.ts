import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPreflight } from "./run-preflight.js";
import { withEphemeralEnvironment } from "../dynamic/environment.js";
import type { TestKitConfig } from "../../config/schema.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "examples", "sample-project");

/**
 * Regression test for a real bug found running this tool against a genuinely
 * separate project (a real Temporal_Project) whose worker entry point lives
 * in a subdirectory (src/temporal/worker.ts), not directly under src/ — the
 * same shape every prior test fixture (examples/sample-project, the
 * acceptance-check project) happened to avoid. runPreflight's "worker boot
 * sanity check" hardcoded `<projectRoot>/src/workflows.ts` and
 * `<projectRoot>/src/activities.ts`, ignoring config.workerEntryPoint
 * entirely — so it fatally failed with "Cannot find module .../src/
 * activities.ts" for any project keeping those files anywhere else, even
 * though every other part of the tool derives that path from
 * workerEntryPoint correctly.
 *
 * This test uses a genuinely fresh, isolated project root (no `src/`
 * directory at all — deliberately so the hardcoded fallback path this bug
 * used can't accidentally succeed by finding some OTHER real file there,
 * the mistake an earlier version of this test made by reusing
 * examples/sample-project as projectRoot, which happens to also have a
 * real src/workflows.ts/src/activities.ts of its own) with only a
 * `nested/worker.ts` + `nested/workflows.ts` + `nested/activities.ts` —
 * proving preflight finds them there, derived from workerEntryPoint, not
 * from a hardcoded src/ assumption.
 */
describe("runPreflight resolves workflows.ts/activities.ts relative to workerEntryPoint", () => {
  it("passes when the worker entry point (and its workflows.ts/activities.ts) live in a subdirectory, not directly under src/, and there is no src/ directory at all", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ttk-nested-fixture-"));
    const fixtureDir = join(projectRoot, "nested");
    mkdirSync(fixtureDir, { recursive: true });
    symlinkSync(join(SAMPLE_PROJECT, "node_modules"), join(projectRoot, "node_modules"), "dir");

    writeFileSync(
      join(fixtureDir, "worker.ts"),
      `import { Worker } from "@temporalio/worker";\nimport * as activities from "./activities.js";\nasync function main() {\n  const worker = await Worker.create({ workflowsPath: new URL("./workflows.ts", import.meta.url).pathname, activities, taskQueue: "nested-fixture" });\n  await worker.run();\n}\nmain();\n`,
    );
    writeFileSync(
      join(fixtureDir, "workflows.ts"),
      `export async function NestedFixtureWorkflow(): Promise<string> {\n  return "ok";\n}\n`,
    );
    writeFileSync(join(fixtureDir, "activities.ts"), `export {};\n`);

    const config: TestKitConfig = {
      project: "nested-fixture",
      workerEntryPoint: "./nested/worker.ts",
      taskQueues: ["nested-fixture"],
      workflows: [{ type: "NestedFixtureWorkflow", taskQueue: "nested-fixture" }],
    };

    try {
      await withEphemeralEnvironment(async (env) => {
        const report = await runPreflight({
          projectRoot,
          configResult: { ok: true, config },
          nodeVersion: process.version,
          port: 58735,
          env,
        });

        expect(report.fatalMessage).toBeNull();
        expect(report.passed).toBe(true);
        const bootCheck = report.results.find((r) => r.name === "worker boot sanity check");
        expect(bootCheck?.passed).toBe(true);
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
