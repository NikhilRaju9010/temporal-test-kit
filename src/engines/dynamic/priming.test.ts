import { describe, expect, it } from "vitest";
import { sendPrimingSignals } from "./priming.js";

function recordingHandle() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  return {
    calls,
    async signal(name: string, ...args: unknown[]) {
      calls.push({ name, args });
    },
  };
}

describe("sendPrimingSignals — the default (unconfigured) path sends nothing at all", () => {
  it("sends zero signals when primingSignals is undefined", async () => {
    const handle = recordingHandle();
    await sendPrimingSignals(handle, undefined);
    expect(handle.calls).toEqual([]);
  });

  it("sends zero signals when primingSignals is an empty array", async () => {
    const handle = recordingHandle();
    await sendPrimingSignals(handle, []);
    expect(handle.calls).toEqual([]);
  });

  it("sends zero signals when primingSignals is null (a hand-edited config can produce this)", async () => {
    const handle = recordingHandle();
    await sendPrimingSignals(handle, null as unknown as undefined);
    expect(handle.calls).toEqual([]);
  });
});

describe("sendPrimingSignals — configured", () => {
  it("sends each configured signal once, with its payload, in configured order", async () => {
    const handle = recordingHandle();
    await sendPrimingSignals(handle, [
      { name: "clientConsentReceived", payload: { accountId: "acct-001" } },
      { name: "advisorApprovalReceived", payload: { decision: "APPROVE" } },
    ]);
    expect(handle.calls).toEqual([
      { name: "clientConsentReceived", args: [{ accountId: "acct-001" }] },
      { name: "advisorApprovalReceived", args: [{ decision: "APPROVE" }] },
    ]);
  });

  it("awaits each send before the next, so order-dependent handlers see them in order", async () => {
    const order: string[] = [];
    const handle = {
      async signal(name: string) {
        order.push(`start:${name}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end:${name}`);
      },
    };
    await sendPrimingSignals(handle, [
      { name: "first", payload: undefined },
      { name: "second", payload: undefined },
    ]);
    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });
});
