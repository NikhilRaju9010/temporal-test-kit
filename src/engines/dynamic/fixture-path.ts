import { join } from "node:path";

/**
 * Builds the path to one of this engine's own internal probe-workflow
 * fixtures (D1/E1/H2/I1/I5/L1's own throwaway workflows — never the target
 * project's code), adapting the extension to how the CALLING check module
 * itself is currently running: `.ts` when executing straight from source
 * (dev, or this repo's own test suite, via tsx), or `.js` when executing
 * from a compiled `dist/` build (installed via git by a consuming
 * project).
 *
 * This distinction is load-bearing, not cosmetic — reproduced via a real
 * external `npm install git+...` into a genuinely separate project, not
 * assumed: Temporal's own workflow-bundling webpack config, like most
 * webpack/ts-loader setups, does not transform TypeScript found under
 * `node_modules`. `tsc` already compiles every fixture `.ts` into a
 * sibling `.js` (this repo's normal build, `tsconfig.build.json`'s
 * `include` covers `fixtures/` same as any other source) — the bug was
 * that every one of these six checks hardcoded the `.ts` filename as
 * `workflowsPath`, ignoring the perfectly good compiled `.js` sitting
 * right next to it, so a real consumer's Temporal bundler choked trying to
 * parse raw TypeScript under `node_modules/temporal-test-kit/dist/...`.
 */
export function fixturePath(callerImportMetaUrl: string, dirname: string, baseName: string): string {
  const ext = callerImportMetaUrl.endsWith(".ts") ? ".ts" : ".js";
  return join(dirname, "fixtures", `${baseName}${ext}`);
}
