#!/usr/bin/env node
// Re-execs this same script once, with tsx's loader registered via
// --import, before cli.js (and transitively, the target project's own
// workflows.ts/activities.ts) ever loads. Re-executing — rather than
// programmatically registering tsx's loader in-process — is required, not
// a style choice: tsx's own loader entry point (the "tsx" package's "."
// export) is designed to be activated via Node's --import/--loader
// mechanism, which wires up BOTH its ESM hooks and its CJS require()
// interop together; a plain `import "tsx"` or importing "tsx/esm/api"'s
// register() only activates the ESM half, which resolves straightforward
// ESM-style TypeScript fine but still fails to resolve CommonJS-style
// extensionless relative imports (`from "../repositories/foo"`, no .js) —
// confirmed by testing both against a real, independently-built project
// before landing on this fix, not assumed. Without --import tsx at all,
// dynamically importing a target project's .ts files falls back to
// whatever bare, limited TypeScript support the current Node version has
// built in (type-stripping only, no bundler-style module resolution),
// which silently worked against every one of this tool's own fixtures
// (they all happen to use fully-extensioned ESM imports throughout) and
// silently broke against real, ordinary CommonJS-style TypeScript.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.__TTK_TSX_REGISTERED__) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, __TTK_TSX_REGISTERED__: "1" } },
  );
  process.exit(result.status ?? 1);
}

await import("../dist/cli.js");
