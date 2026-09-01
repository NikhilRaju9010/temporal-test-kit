import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { withEphemeralEnvironment, bootWorker, withRunningWorker, EphemeralEnvironment } from "./environment.js";
import { registerCleanup } from "./cleanup-registry.js";

const SAMPLE_PROJECT = join(import.meta.dirname, "..", "..", "..", "examples", "sample-project");

describe("bootWorker + environment teardown (real @temporalio/testing)", () => {
  it("boots the sample project's worker and tears down the environment without throwing", async () => {
    await withEphemeralEnvironment(async (env) => {
      const activities = await import(join(SAMPLE_PROJECT, "src", "activities.ts"));
      const result = await bootWorker(env, {
        workflowsPath: join(SAMPLE_PROJECT, "src", "workflows.ts"),
        activities,
        taskQueue: "default",
      });
      expect(result.booted).toBe(true);
      expect(result.error).toBeNull();
      // Regression test for: "IllegalStateError: Cannot close connection while
      // Workers hold a reference to it" — teardown must succeed after boot.
    });
  });
});

describe("withEphemeralEnvironment SIGINT handling", () => {
  it("on SIGINT, tears down its own environment AND runs cleanups registered by OTHER resources (e.g. a spawned child-process worker), not just its own env", async () => {
    const envTeardown = vi.fn(async () => {});
    const fakeCreate = async () => ({ teardown: envTeardown }) as unknown as EphemeralEnvironment;
    const exitCalls: (number | undefined)[] = [];
    const fakeExit = ((code?: number) => {
      exitCalls.push(code);
    }) as typeof process.exit;

    const otherResourceTeardown = vi.fn(async () => {});
    registerCleanup(otherResourceTeardown);

    await withEphemeralEnvironment(
      async () => {
        process.emit("SIGINT");
        // Give the async onSignal handler a turn to run before `fn` returns.
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      fakeCreate,
      fakeExit,
    );

    expect(envTeardown).toHaveBeenCalledTimes(1);
    expect(otherResourceTeardown).toHaveBeenCalledTimes(1);
    expect(exitCalls).toEqual([1]);
  });

  it("does not double-teardown its own environment when SIGINT fires and the check then returns normally", async () => {
    const envTeardown = vi.fn(async () => {});
    const fakeCreate = async () => ({ teardown: envTeardown }) as unknown as EphemeralEnvironment;
    const fakeExit = (() => {}) as typeof process.exit;

    await withEphemeralEnvironment(
      async () => {
        process.emit("SIGINT");
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      fakeCreate,
      fakeExit,
    );

    expect(envTeardown).toHaveBeenCalledTimes(1);
  });
});

describe("withRunningWorker abort behavior", () => {
  it("shuts the worker down immediately when the signal aborts, even though fn never returns — and a fresh worker can then register on the same task queue without colliding", async () => {
    await withEphemeralEnvironment(async (env) => {
      const activities = await import(join(SAMPLE_PROJECT, "src", "activities.ts"));
      const target = {
        workflowsPath: join(SAMPLE_PROJECT, "src", "workflows.ts"),
        activities,
        taskQueue: "ttk-environment-test-abort",
      };
      const controller = new AbortController();

      const hangingCall = withRunningWorker(
        env,
        target,
        () => new Promise(() => {}), // never resolves — same shape as the reproduced C2 hang
        controller.signal,
      );

      controller.abort();

      // The call must settle (reject, since fn itself never resolved) promptly —
      // not hang forever. A generous but bounded wait proves this without a flaky race.
      await expect(
        Promise.race([
          hangingCall.then(
            () => "resolved",
            () => "rejected",
          ),
          new Promise((resolve) => setTimeout(() => resolve("still pending"), 5_000)),
        ]),
      ).resolves.not.toBe("still pending");

      // The real proof: a second worker on the SAME task queue registers cleanly.
      // Before this fix, this would throw "Registration of multiple workers with
      // overlapping worker task types" because the first worker was still live.
      const result = await bootWorker(env, target);
      expect(result.booted).toBe(true);
      expect(result.error).toBeNull();
    });
  }, 20_000);

  it("still behaves exactly as before when no signal is passed (bootWorker's own call site)", async () => {
    await withEphemeralEnvironment(async (env) => {
      const activities = await import(join(SAMPLE_PROJECT, "src", "activities.ts"));
      const result = await bootWorker(env, {
        workflowsPath: join(SAMPLE_PROJECT, "src", "workflows.ts"),
        activities,
        taskQueue: "default",
      });
      expect(result.booted).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
