import proto from "@temporalio/proto";

export const EventType = proto.temporal.api.enums.v1.EventType;
export type HistoryEvent = proto.temporal.api.history.v1.IHistoryEvent;

/**
 * The real workflow ID Temporal itself assigned to a child workflow
 * execution, read straight off the PARENT's own recorded event history
 * (`ChildWorkflowExecutionStarted`'s `workflowExecution.workflowId`) —
 * never guessed or derived from any naming convention. This is what lets
 * F1/F2/H3 (the child-workflow dynamic-fixture checks, spec Section 6.3)
 * find and inspect a child workflow's own execution generically, against
 * ANY target project's `workflows[].hasChildWorkflows: true` workflow,
 * regardless of what workflow-ID scheme that project's own `startChild()`
 * call happens to use.
 */
export function findChildWorkflowId(events: HistoryEvent[]): string | undefined {
  const started = events.find((e) => e.eventType === EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_STARTED);
  return started?.childWorkflowExecutionStartedEventAttributes?.workflowExecution?.workflowId ?? undefined;
}

/**
 * The child's own workflow TYPE (e.g. "ChildWorkflow"), from the same
 * ChildWorkflowExecutionStarted event `findChildWorkflowId` reads — used
 * where a check needs to report which workflow type it inspected without
 * requiring any fixture field naming it.
 */
export function findChildWorkflowType(events: HistoryEvent[]): string | undefined {
  const started = events.find((e) => e.eventType === EventType.EVENT_TYPE_CHILD_WORKFLOW_EXECUTION_STARTED);
  return started?.childWorkflowExecutionStartedEventAttributes?.workflowType?.name ?? undefined;
}
