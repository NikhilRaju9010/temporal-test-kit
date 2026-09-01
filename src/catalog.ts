/**
 * The master list of all 49 Temporal compliance tests.
 * Source of truth: "Temporal Complete Test Checklist" / build spec Section 6.
 * Do not add/remove/renumber entries without updating the spec.
 */

export type Engine =
  | "static"
  | "dynamic-zero-fixture"
  | "dynamic-fixture"
  | "not-covered";

export interface CatalogEntry {
  id: string;
  category: string;
  name: string;
  engine: Engine;
  /** Feature flag in config.features that gates this test to N_A when false/unset. */
  requiresFeatureFlag?: string;
  /**
   * The exact dotted config path a dynamic-fixture check's own SKIPPED
   * message names (e.g. `"workflows[].sagaFailurePoint"`,
   * `"features.scheduleWorkflowId"`) — set only on `engine: "dynamic-fixture"`
   * entries. This is a SECOND place naming the same field the check itself
   * reads via `isFixtureMissing`/`missingFixtureResult` in its own file
   * (`src/engines/dynamic/checks/<id>.ts`) — kept only so `--list` can
   * report would-run/needs-fixture without executing anything. The two
   * WILL drift if a check's own field name ever changes without this one
   * being updated to match — `catalog.fixtureField.test.ts` reads every
   * check file's own `missingFixtureResult(base, "...")` call as plain
   * text and fails loudly if either one disagrees with the other, rather
   * than letting `--list` silently start lying about what unlocks a check.
   */
  fixtureField?: string;
}

export const CATALOG: CatalogEntry[] = [
  // A. Workflow Execution & Determinism
  { id: "A1", category: "Workflow Execution & Determinism", name: "Workflow starts and runs correctly", engine: "dynamic-zero-fixture" },
  { id: "A2", category: "Workflow Execution & Determinism", name: "No randomness/unsafe code inside the workflow", engine: "static" },
  { id: "A3", category: "Workflow Execution & Determinism", name: "Starting the same workflow twice behaves correctly", engine: "dynamic-zero-fixture" },
  { id: "A4", category: "Workflow Execution & Determinism", name: "Data isn't lost or corrupted going in/out", engine: "dynamic-zero-fixture" },
  { id: "A5", category: "Workflow Execution & Determinism", name: "Eager workflow start", engine: "not-covered" },

  // B. Activities
  { id: "B1", category: "Activities", name: "Every activity has a timeout", engine: "static" },
  { id: "B2", category: "Activities", name: "Retry settings make sense", engine: "static" },
  { id: "B3", category: "Activities", name: "Retrying a step doesn't repeat its effect", engine: "dynamic-fixture", fixtureField: "workflows[].idempotencyTestActivity" },
  { id: "B4", category: "Activities", name: "Long steps send heartbeats", engine: "dynamic-zero-fixture" },
  { id: "B5", category: "Activities", name: "Cancelling a step actually stops it", engine: "dynamic-zero-fixture" },
  { id: "B6", category: "Activities", name: "\"Local Activities\" are only used for short, simple steps", engine: "static" },
  { id: "B7", category: "Activities", name: "Pausing/resuming a live activity works safely", engine: "not-covered" },

  // C. Signals, Queries & Updates
  { id: "C1", category: "Signals, Queries & Updates", name: "Signals are received correctly, including duplicates and late ones", engine: "dynamic-fixture", fixtureField: "workflows[].signals" },
  { id: "C2", category: "Signals, Queries & Updates", name: "Queries never change anything", engine: "dynamic-fixture", fixtureField: "workflows[].queries" },
  { id: "C3", category: "Signals, Queries & Updates", name: "Invalid updates are rejected before anything changes", engine: "dynamic-fixture", requiresFeatureFlag: "updates", fixtureField: "workflows[].updates" },
  { id: "C4", category: "Signals, Queries & Updates", name: "Update-with-Start doesn't create duplicates", engine: "dynamic-fixture", requiresFeatureFlag: "updateWithStart", fixtureField: "workflows[].updates" },
  { id: "C5", category: "Signals, Queries & Updates", name: "Signal/update handling doesn't get the workflow stuck", engine: "dynamic-fixture", fixtureField: "workflows[].signals or workflows[].updates" },

  // D. Timers & Scheduling
  { id: "D1", category: "Timers & Scheduling", name: "Waiting/timers behave consistently", engine: "dynamic-zero-fixture" },
  { id: "D2", category: "Timers & Scheduling", name: "Scheduled (recurring) workflows fire at the right time", engine: "dynamic-fixture", requiresFeatureFlag: "schedules", fixtureField: "features.scheduleWorkflowId" },
  { id: "D3", category: "Timers & Scheduling", name: "Overlapping scheduled runs are handled correctly", engine: "dynamic-fixture", requiresFeatureFlag: "schedules", fixtureField: "features.scheduleWorkflowId" },
  { id: "D4", category: "Timers & Scheduling", name: "Missed scheduled runs are handled correctly after downtime", engine: "dynamic-fixture", requiresFeatureFlag: "schedules", fixtureField: "features.scheduleWorkflowId" },

  // E. Long-Running Workflows
  { id: "E1", category: "Long-Running Workflows", name: "Long workflows \"reset\" their history before it gets too big", engine: "dynamic-zero-fixture" },
  { id: "E2", category: "Long-Running Workflows", name: "Nothing is lost when the workflow resets itself", engine: "dynamic-fixture", fixtureField: "workflows[].isLongRunning" },

  // F. Child Workflows & Cross-Service Calls
  { id: "F1", category: "Child Workflows & Cross-Service Calls", name: "A failing child workflow is handled correctly by its parent", engine: "dynamic-fixture", requiresFeatureFlag: "childWorkflows", fixtureField: "workflows[].hasChildWorkflows" },
  { id: "F2", category: "Child Workflows & Cross-Service Calls", name: "Child workflows don't get orphaned", engine: "dynamic-fixture", requiresFeatureFlag: "childWorkflows", fixtureField: "workflows[].hasChildWorkflows" },
  { id: "F3", category: "Child Workflows & Cross-Service Calls", name: "Cross-service (Nexus) calls work correctly", engine: "not-covered", requiresFeatureFlag: "nexus" },

  // G. Multi-Step Failure Handling (Saga Pattern)
  { id: "G1", category: "Multi-Step Failure Handling (Saga Pattern)", name: "A mid-process failure doesn't leave things half-done", engine: "dynamic-fixture", fixtureField: "workflows[].sagaFailurePoint" },
  { id: "G2", category: "Multi-Step Failure Handling (Saga Pattern)", name: "Permanent failures don't retry forever", engine: "static" },

  // H. Cancellation & Termination
  { id: "H1", category: "Cancellation & Termination", name: "Cancel runs cleanup", engine: "dynamic-fixture", fixtureField: "workflows[].hasCleanupOnCancel" },
  { id: "H2", category: "Cancellation & Termination", name: "Terminate skips cleanup (on purpose)", engine: "dynamic-zero-fixture" },
  { id: "H3", category: "Cancellation & Termination", name: "Cancelling a parent also handles its children/activities correctly", engine: "dynamic-fixture", requiresFeatureFlag: "childWorkflows", fixtureField: "workflows[].hasChildWorkflows" },

  // I. Worker Deployment, Scaling & Versioning
  { id: "I1", category: "Worker Deployment, Scaling & Versioning", name: "Worker crash recovery", engine: "dynamic-zero-fixture" },
  { id: "I2", category: "Worker Deployment, Scaling & Versioning", name: "New code doesn't break workflows already running", engine: "not-covered" },
  { id: "I3", category: "Worker Deployment, Scaling & Versioning", name: "Replay test passes on real history", engine: "dynamic-zero-fixture" },
  { id: "I4", category: "Worker Deployment, Scaling & Versioning", name: "Work lands on the correct task queue", engine: "dynamic-zero-fixture" },
  { id: "I5", category: "Worker Deployment, Scaling & Versioning", name: "Worker restart doesn't stall the workflow (sticky queue recovery)", engine: "dynamic-zero-fixture" },
  { id: "I6", category: "Worker Deployment, Scaling & Versioning", name: "Gradual deploys don't drop work", engine: "not-covered" },
  { id: "I7", category: "Worker Deployment, Scaling & Versioning", name: "Repeated worker restarts don't break things over time", engine: "not-covered" },

  // J. Observability
  { id: "J1", category: "Observability", name: "Every workflow's full story is visible", engine: "dynamic-zero-fixture" },
  { id: "J2", category: "Observability", name: "Custom search/filter fields work", engine: "dynamic-fixture", requiresFeatureFlag: "searchAttributes", fixtureField: "features.customSearchAttributeKeys" },
  { id: "J3", category: "Observability", name: "Failure messages are actually useful", engine: "dynamic-zero-fixture" },

  // K. Data & Security
  { id: "K1", category: "Data & Security", name: "Data doesn't get corrupted on the way in/out", engine: "dynamic-zero-fixture" },
  { id: "K2", category: "Data & Security", name: "Sensitive data isn't exposed in plain text", engine: "dynamic-fixture", fixtureField: "workflows[].sensitiveDataFields" },
  { id: "K3", category: "Data & Security", name: "Only authorized people/systems can act on a workflow", engine: "not-covered" },

  // L. Resilience to Outages
  { id: "L1", category: "Resilience to Outages", name: "Temporal Server outage recovery", engine: "dynamic-zero-fixture" },
  { id: "L2", category: "Resilience to Outages", name: "A dependency outage doesn't lose work", engine: "dynamic-fixture", fixtureField: "workflows[].dependencyOutageTestActivity" },
  { id: "L3", category: "Resilience to Outages", name: "Failover between environments doesn't strand work", engine: "not-covered" },

  // M. Load, Concurrency & Resource Limits
  { id: "M1", category: "Load, Concurrency & Resource Limits", name: "The system holds up under many workflows at once", engine: "not-covered" },
  { id: "M2", category: "Load, Concurrency & Resource Limits", name: "Worker doesn't fall over under heavy load", engine: "not-covered" },
];
