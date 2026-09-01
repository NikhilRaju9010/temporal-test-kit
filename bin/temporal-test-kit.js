#!/usr/bin/env node
// Registers tsx's ESM loader hooks into this process BEFORE cli.js (and,
// transitively, the target project's own workflows.ts/activities.ts) ever
// gets loaded. Without this, dynamically importing a target project's .ts
// files falls back to whatever bare, limited TypeScript support the current
// Node version happens to have built in (type-stripping only, no bundler-
// style module resolution) — which can parse straightforward ESM-style
// TypeScript, but breaks on anything a real, pre-existing project might do
// that tsx handles correctly, e.g. CommonJS-style extensionless relative
// imports (`from "../repositories/foo"` instead of `from
// "../repositories/foo.js"`) — reproduced for real against a genuinely
// external project (not one of this tool's own fixtures, which happen to
// all use fully-extensioned ESM imports), not assumed. A dynamic import()
// for cli.js itself (rather than a static one) is required here — a static
// `import` is resolved before any other code in this module runs, which
// would resolve before register() ever executes.
import { register } from "tsx/esm/api";
register();
await import("../dist/cli.js");
