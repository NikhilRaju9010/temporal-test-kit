import { ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import readline from "node:readline";
import { EphemeralEnvironment } from "./environment.js";
import { registerCleanup } from "./cleanup-registry.js";

/**
 * `child-worker-entry.ts` is spawned via `tsx`, and `tsc` already emits a
 * working `child-worker-entry.js` right alongside it in `dist/` as part of
 * the normal build — no separate copy step needed. The only wrinkle is
 * picking the RIGHT sibling file: this module resolves its own entry path
 * by matching its own file extension, so it spawns `child-worker-entry.ts`
 * when running from source (under `vitest`, where only the `.ts` exists)
 * and `child-worker-entry.js` when running from the built `dist/cli.js`
 * (where only the `.js` exists) — never hardcode one extension here, or the
 * other run mode breaks. `tsx` handles both identically (a no-op transform
 * for already-plain JS), so the spawn command itself doesn't need to branch.
 * The dynamic-check fixtures under `checks/fixtures/*.ts` (`fixture-path.ts`)
 * use this exact same self-extension-matching pattern for the same reason.
 */
const SELF_EXTENSION = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
const ENTRY_PATH = join(import.meta.dirname, `child-worker-entry${SELF_EXTENSION}`);
const BOOT_TIMEOUT_MS = 15_000;

export interface ChildWorkerTarget {
  taskQueue: string;
  workflowsPath: string;
  /** A filesystem path, not a live module object — the child process does its own `import()` (see child-worker-entry.ts). */
  activitiesPath: string;
}

export interface KillableWorker {
  readonly pid: number;
  /** Sends `signal` (default SIGKILL) and waits for the process to actually exit (reaped), never leaving a zombie. Safe to call more than once. */
  kill(signal?: NodeJS.Signals): Promise<void>;
}

/**
 * Spawns a REAL, separate OS process running a Temporal worker against
 * `env`, and returns a handle that can kill it ungracefully (SIGKILL, no
 * drain, task token abandoned) — something an in-process `Worker` cannot be
 * forced into (see child-worker-entry.ts's doc comment for why). This is
 * the shared piece I1 (worker crash recovery) needs; L1 does NOT reuse it —
 * L1 kills the Temporal *server*, not a worker, and gets its own private
 * disposable environment instead (see l1.ts).
 *
 * Runs the bootstrap script directly from TypeScript source via `tsx`
 * (`--import tsx`), the same way regardless of whether this package is
 * running under `vitest` or as the built `dist/cli.js` — deliberately
 * avoiding the dist/src dual-path split that bit the fixture-copy build
 * step (see CLAUDE.md): this script isn't consumed by Temporal's own
 * bundler, so there's no reason to require compiled output for it.
 */
export async function spawnKillableWorker(env: EphemeralEnvironment, target: ChildWorkerTarget): Promise<KillableWorker> {
  const child = spawn(process.execPath, ["--import", "tsx", ENTRY_PATH], {
    env: {
      ...process.env,
      TTK_ADDRESS: env.address,
      TTK_NAMESPACE: env.namespace ?? "default",
      TTK_TASK_QUEUE: target.taskQueue,
      TTK_WORKFLOWS_PATH: target.workflowsPath,
      TTK_ACTIVITIES_PATH: target.activitiesPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const unregisterCleanup = registerCleanup(() => killAndReap(child, "SIGKILL"));

  try {
    await waitForBoot(child);
  } catch (e) {
    unregisterCleanup();
    await killAndReap(child, "SIGKILL");
    throw e;
  }

  let killed = false;
  return {
    pid: child.pid!,
    async kill(signal: NodeJS.Signals = "SIGKILL") {
      if (killed) return;
      killed = true;
      unregisterCleanup();
      await killAndReap(child, signal);
    },
  };
}

function waitForBoot(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderrChunks: string[] = [];
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk.toString()));

    const rl = readline.createInterface({ input: child.stdout! });
    const onLine = (line: string) => {
      if (line.trim() === "WORKER_BOUND") {
        cleanup();
        resolve();
      }
    };
    rl.on("line", onLine);

    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `child-worker process exited before booting (code ${code}): ${stderrChunks.join("").trim() || "no stderr output"}`,
        ),
      );
    };
    child.once("exit", onExit);

    const onError = (e: Error) => {
      cleanup();
      reject(new Error(`child-worker process failed to spawn: ${e.message}`));
    };
    child.once("error", onError);

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`child-worker process did not signal WORKER_BOUND within ${BOOT_TIMEOUT_MS}ms`));
    }, BOOT_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      rl.off("line", onLine);
      child.off("exit", onExit);
      child.off("error", onError);
    }
  });
}

function killAndReap(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill(signal);
  });
}
