import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { CATALOG } from "../../../catalog.js";
import { TestResult } from "../../../report/types.js";
import { EphemeralEnvironment, WorkerTarget, withRunningWorker } from "../environment.js";
import { generateWorkflowId } from "../workflow-id.js";

const CATALOG_ENTRY = CATALOG.find((c) => c.id === "A3")!;

/**
 * Racing two concurrent starts under the same ID is the only reliable way to
 * exercise "starting the same workflow twice" against a zero-fixture target
 * like the sample project's GreetingWorkflow: it takes no input and can
 * complete almost instantly, so a naive start -> wait -> start-again sequence
 * risks the first execution already being CLOSED by the time the second
 * start fires, which would legitimately succeed as a fresh execution under
 * default reuse policy and wouldn't test duplicate-start rejection at all.
 * Firing both `client.workflow.start` calls concurrently with the exact same
 * workflowId, targeting a live worker, means the server sees both
 * StartWorkflowExecution requests while the ID is (at worst, momentarily)
 * open, so its atomic dedup on workflowId does the real work.
 */
type RaceOutcome =
  | { kind: "duplicate-rejected" }
  | { kind: "both-succeeded" }
  | { kind: "unexpected"; detail: string };

async function raceDuplicateStart(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  workflowId: string,
  signal?: AbortSignal,
): Promise<RaceOutcome> {
  return withRunningWorker(
    env,
    target,
    async () => {
    const [a, b] = await Promise.allSettled([
      env.client.workflow.start(target.workflowType, {
        taskQueue: target.taskQueue,
        workflowId,
        args: [],
      }),
      env.client.workflow.start(target.workflowType, {
        taskQueue: target.taskQueue,
        workflowId,
        args: [],
      }),
    ]);

    const isAlreadyStarted = (r: PromiseSettledResult<unknown>) =>
      r.status === "rejected" &&
      (r.reason instanceof WorkflowExecutionAlreadyStartedError ||
        (r.reason as Error | undefined)?.name === "WorkflowExecutionAlreadyStartedError");

    const fulfilledCount = [a, b].filter((r) => r.status === "fulfilled").length;
    const alreadyStartedCount = [a, b].filter(isAlreadyStarted).length;

    if (fulfilledCount === 1 && alreadyStartedCount === 1) {
      return { kind: "duplicate-rejected" };
    }
    if (fulfilledCount === 2) {
      return { kind: "both-succeeded" };
    }

      const detail = [a, b]
        .map((r) => (r.status === "fulfilled" ? "fulfilled" : `rejected: ${(r.reason as Error)?.message ?? r.reason}`))
        .join(" | ");
      return { kind: "unexpected", detail };
    },
    signal,
  );
}

/**
 * A handful of retries with a fresh workflowId each time guards against
 * genuine infra hiccups (e.g. a transient connection error making both
 * calls reject for reasons unrelated to duplicate-start detection) producing
 * a false FAIL on an otherwise-healthy target. It does NOT retry away a
 * "both succeeded" outcome, since that's a deterministic, meaningful finding
 * (the server allowed two executions under one ID) rather than noise.
 */
const MAX_ATTEMPTS = 3;

export async function checkA3DuplicateStart(
  env: EphemeralEnvironment,
  target: WorkerTarget & { workflowType: string },
  signal?: AbortSignal,
): Promise<TestResult> {
  const base = {
    id: CATALOG_ENTRY.id,
    category: CATALOG_ENTRY.category,
    name: CATALOG_ENTRY.name,
    target: target.workflowType,
    engine: "dynamic-zero-fixture" as const,
  };

  let lastOutcome: RaceOutcome | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const workflowId = generateWorkflowId("A3", target.workflowType);
    const outcome = await raceDuplicateStart(env, target, workflowId, signal);
    lastOutcome = outcome;

    if (outcome.kind === "duplicate-rejected") {
      return {
        ...base,
        status: "PASS",
        message:
          `Starting ${target.workflowType} twice concurrently under the same workflow ID correctly succeeded once ` +
          "and rejected the duplicate with WorkflowExecutionAlreadyStartedError.",
        hint: null,
      };
    }

    if (outcome.kind === "both-succeeded") {
      return {
        ...base,
        status: "FAIL",
        message: `Both concurrent starts of ${target.workflowType} under the same workflow ID succeeded.`,
        hint:
          "The Temporal server should reject a second StartWorkflowExecution call for a workflow ID that's still " +
          "OPEN with WorkflowExecutionAlreadyStartedError. Seeing both calls succeed means two executions are " +
          "running under a tracking ID your application code believes is unique — this can let duplicate or " +
          "conflicting workflow instances run concurrently and corrupt any external state or invariants that " +
          "assume one execution per ID. Check the workflow ID reuse policy being used and whether requests are " +
          "somehow reaching different namespaces/clusters.",
      };
    }

    // outcome.kind === "unexpected" — retry with a fresh ID in case this was
    // a transient infra hiccup rather than a duplicate-start finding.
  }

  const detail = lastOutcome && lastOutcome.kind === "unexpected" ? lastOutcome.detail : "unknown";
  return {
    ...base,
    status: "FAIL",
    message:
      `Duplicate-start handling for ${target.workflowType} behaved unexpectedly across ${MAX_ATTEMPTS} attempts ` +
      `(neither "one rejected as duplicate" nor "both succeeded"). Last attempt: ${detail}`,
    hint:
      "Expected exactly one of the two concurrent same-ID starts to be rejected with " +
      "WorkflowExecutionAlreadyStartedError and the other to succeed. Getting neither pattern repeatedly suggests " +
      "an infrastructure or connectivity issue rather than a clean duplicate-start finding — investigate the " +
      "ephemeral Temporal test server/worker logs for this run before treating this as a project defect.",
  };
}
