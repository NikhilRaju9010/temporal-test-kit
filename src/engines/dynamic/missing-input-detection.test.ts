import { describe, expect, it } from "vitest";
import proto from "@temporalio/proto";
import { detectPossibleMissingInputCrash } from "./missing-input-detection.js";

const EventType = proto.temporal.api.enums.v1.EventType;

function taskFailed(message: string) {
  return {
    eventType: EventType.EVENT_TYPE_WORKFLOW_TASK_FAILED,
    workflowTaskFailedEventAttributes: { failure: { message } },
  } as proto.temporal.api.history.v1.IHistoryEvent;
}

function taskCompleted() {
  return { eventType: EventType.EVENT_TYPE_WORKFLOW_TASK_COMPLETED } as proto.temporal.api.history.v1.IHistoryEvent;
}

function started() {
  return { eventType: EventType.EVENT_TYPE_WORKFLOW_EXECUTION_STARTED } as proto.temporal.api.history.v1.IHistoryEvent;
}

describe("detectPossibleMissingInputCrash", () => {
  it("suspects a missing-arg crash: zero completed tasks + a 'Cannot read properties of undefined' first failure", () => {
    const result = detectPossibleMissingInputCrash([
      started(),
      taskFailed("Cannot read properties of undefined (reading 'agentRetry')"),
    ]);
    expect(result.suspected).toBe(true);
    expect(result.failureMessage).toContain("agentRetry");
  });

  it("also matches the older V8 singular 'property' phrasing", () => {
    const result = detectPossibleMissingInputCrash([started(), taskFailed("Cannot read property 'foo' of undefined")]);
    expect(result.suspected).toBe(true);
  });

  it("also matches 'of null' (not just 'of undefined')", () => {
    const result = detectPossibleMissingInputCrash([started(), taskFailed("Cannot read properties of null (reading 'bar')")]);
    expect(result.suspected).toBe(true);
  });

  it("matches the destructured-local-variable shape ('Cannot destructure property ... as it is undefined')", () => {
    const result = detectPossibleMissingInputCrash([
      started(),
      taskFailed("Cannot destructure property 'foo' of 'input' as it is undefined."),
    ]);
    expect(result.suspected).toBe(true);
  });

  it("matches the destructured-parameter shape (source name is the literal string 'undefined', not a variable name)", () => {
    const result = detectPossibleMissingInputCrash([
      started(),
      taskFailed("Cannot destructure property 'foo' of 'undefined' as it is undefined."),
    ]);
    expect(result.suspected).toBe(true);
  });

  it("does NOT suspect a missing-arg crash when the failure message is unrelated (negative control: a real, unconditional bug)", () => {
    const result = detectPossibleMissingInputCrash([
      started(),
      taskFailed("intentional non-input-related crash for negative-control testing"),
    ]);
    expect(result.suspected).toBe(false);
    // The raw message is still surfaced even when not suspected, so callers
    // that want to show it can — but they must not claim it's a missing-arg
    // crash. This assertion exists so a caller can't be tempted to skip
    // showing failureMessage just because suspected is false.
    expect(result.failureMessage).toContain("negative-control");
  });

  it("does NOT suspect anything once even one task has ever completed — a crash later in the run is not this pattern", () => {
    const result = detectPossibleMissingInputCrash([
      started(),
      taskCompleted(),
      taskFailed("Cannot read properties of undefined (reading 'x')"),
    ]);
    expect(result.suspected).toBe(false);
  });

  it("does NOT suspect anything when there is no WorkflowTaskFailed at all (e.g. workflow is genuinely just running)", () => {
    const result = detectPossibleMissingInputCrash([started()]);
    expect(result.suspected).toBe(false);
    expect(result.failureMessage).toBeUndefined();
  });

  it("does NOT suspect anything on an empty history", () => {
    const result = detectPossibleMissingInputCrash([]);
    expect(result.suspected).toBe(false);
  });
});
