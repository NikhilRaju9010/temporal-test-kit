import { existsSync, readFileSync } from "node:fs";
import { TestKitConfig, validateConfig } from "./schema.js";
import { stripJsonLineComments } from "./jsonc.js";

export type LoadConfigResult =
  | { ok: true; config: TestKitConfig }
  | { ok: false; reason: string };

export function loadConfig(path: string): LoadConfigResult {
  if (!existsSync(path)) {
    return { ok: false, reason: `Config file not found at ${path}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonLineComments(readFileSync(path, "utf-8")));
  } catch (e) {
    return { ok: false, reason: `Config file contains invalid JSON: ${(e as Error).message}` };
  }

  const result = validateConfig(parsed);
  if (!result.valid) {
    return { ok: false, reason: `Config file failed validation: ${result.errors.join("; ")}` };
  }

  return { ok: true, config: parsed as TestKitConfig };
}
