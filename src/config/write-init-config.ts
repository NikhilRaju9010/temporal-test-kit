import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateInitTemplate } from "./init-template.js";

const CONFIG_FILENAME = "temporal-test-kit.config.json";

export type WriteInitConfigResult =
  | { ok: true; path: string }
  | { ok: false; path: string; reason: string };

/**
 * The actual file-writing logic behind `temporal-test-kit init`, pulled out
 * of `cli.ts` so it's directly unit-testable — `cli.ts`'s `main()` runs
 * unconditionally on import (not guarded by an entrypoint check), so
 * importing anything from that file in a test would trigger a real CLI
 * dispatch against the TEST process's own `process.argv`/`process.cwd()`.
 * `cli.ts`'s `init` handler is a thin wrapper: call this, print the result.
 *
 * Refuses to overwrite an existing config file — `init` is a one-time
 * starter generator, not something that should silently clobber a dev's
 * real, already-filled-in fixture data.
 */
export function writeInitConfig(projectRoot: string): WriteInitConfigResult {
  const path = join(projectRoot, CONFIG_FILENAME);

  if (existsSync(path)) {
    return {
      ok: false,
      path,
      reason: `${CONFIG_FILENAME} already exists at ${path} — not overwriting. Delete or rename it first if you want to regenerate the starter template.`,
    };
  }

  writeFileSync(path, generateInitTemplate());
  return { ok: true, path };
}
