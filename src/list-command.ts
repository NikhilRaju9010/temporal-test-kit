import { CATALOG, CatalogEntry } from "./catalog.js";
import { TestKitConfig, WorkflowConfig, FeaturesConfig } from "./config/schema.js";

/**
 * Boolean fixture fields where `false` is a real, meaningful "not set up
 * for this" value — not merely "unset". `isFixtureMissing`-style loose
 * checks would treat `false` as present; these need `=== true` instead,
 * matching exactly what checkE2/F1/F2/H1/H3's own code does.
 */
const STRICT_TRUE_FIELDS = new Set(["isLongRunning", "hasChildWorkflows", "hasCleanupOnCancel"]);

function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/** Resolves one dotted fixtureField path (e.g. "workflows[].sagaFailurePoint", "features.scheduleWorkflowId") against a specific workflow entry + project-wide features. */
function resolveSinglePath(path: string, workflow: WorkflowConfig, features: FeaturesConfig): boolean {
  if (path.startsWith("workflows[].")) {
    const field = path.slice("workflows[].".length) as keyof WorkflowConfig;
    const value = workflow[field];
    return STRICT_TRUE_FIELDS.has(field) ? value === true : !isMissing(value);
  }
  if (path.startsWith("features.")) {
    const field = path.slice("features.".length) as keyof FeaturesConfig;
    return !isMissing(features[field]);
  }
  return false;
}

/** A fixtureField may be "X or Y" (C5's OR-gated field) — unlocked if EITHER side resolves. */
function isFixtureUnlocked(fixtureField: string, workflow: WorkflowConfig, features: FeaturesConfig): boolean {
  return fixtureField.split(" or ").some((path) => resolveSinglePath(path.trim(), workflow, features));
}

function formatLine(entry: CatalogEntry, status: string, target?: string): string {
  const suffix = target ? ` (${target})` : "";
  return `  [${status}] ${entry.id} ${entry.name}${suffix}`;
}

/**
 * Computes what `audit --list` prints: for every one of the 49 catalog
 * checks, whether it would run, is not applicable (feature flag off), needs
 * fixture data (naming the exact field), or isn't covered by this tool at
 * all — all WITHOUT executing anything. Dynamic checks (zero-fixture and
 * fixture-based) get one line per configured workflow, matching how the
 * real audit report itself is structured; static and not-covered checks
 * are project-level (one line each).
 */
export function computeListLines(config: TestKitConfig): string[] {
  const features = config.features ?? {};
  const lines: string[] = [];

  for (const entry of CATALOG) {
    if (entry.engine === "static") {
      lines.push(formatLine(entry, "would run"));
      continue;
    }
    if (entry.engine === "not-covered") {
      lines.push(formatLine(entry, "not covered"));
      continue;
    }

    // dynamic-zero-fixture / dynamic-fixture: once per configured workflow.
    for (const workflow of config.workflows) {
      if (entry.requiresFeatureFlag && features[entry.requiresFeatureFlag as keyof FeaturesConfig] !== true) {
        lines.push(formatLine(entry, `N/A: features.${entry.requiresFeatureFlag} unused`, workflow.type));
        continue;
      }
      if (entry.engine === "dynamic-zero-fixture") {
        lines.push(formatLine(entry, "would run", workflow.type));
        continue;
      }
      // dynamic-fixture
      if (entry.fixtureField && !isFixtureUnlocked(entry.fixtureField, workflow, features)) {
        lines.push(formatLine(entry, `needs fixture: ${entry.fixtureField}`, workflow.type));
        continue;
      }
      // D2/D3/D4 have an ADDITIONAL gate their fixtureField alone can't
      // express: even once features.scheduleWorkflowId is set, each of
      // them only actually runs for the ONE workflow whose type matches it
      // — every other configured workflow gets a real SKIPPED in the
      // actual audit (d2.ts's own "this project's one designated
      // schedule-test workflow" branch), not a run. Special-cased here
      // rather than generalizing fixtureField into something that can
      // express "field value must equal this workflow's own type" for a
      // pattern only these three checks currently have.
      if (entry.fixtureField === "features.scheduleWorkflowId" && workflow.type !== features.scheduleWorkflowId) {
        lines.push(formatLine(entry, `skipped: not the designated features.scheduleWorkflowId ("${features.scheduleWorkflowId}")`, workflow.type));
        continue;
      }
      lines.push(formatLine(entry, "would run", workflow.type));
    }
  }

  return lines;
}
