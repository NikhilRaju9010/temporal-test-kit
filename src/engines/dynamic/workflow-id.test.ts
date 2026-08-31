import { describe, expect, it } from "vitest";
import { generateWorkflowId } from "./workflow-id.js";

describe("generateWorkflowId", () => {
  it("includes the test id and workflow type for readability", () => {
    const id = generateWorkflowId("I3", "GreetingWorkflow");
    expect(id).toContain("I3");
    expect(id).toContain("GreetingWorkflow");
  });

  it("is prefixed so ephemeral-run workflow ids are recognizable in the Temporal Web UI", () => {
    const id = generateWorkflowId("I3", "GreetingWorkflow");
    expect(id.startsWith("ttk-")).toBe(true);
  });

  it("generates a different id on every call, even for the same test id and workflow type", () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => generateWorkflowId("I3", "GreetingWorkflow")),
    );
    expect(ids.size).toBe(50);
  });
});
