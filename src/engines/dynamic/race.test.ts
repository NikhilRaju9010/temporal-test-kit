import { describe, expect, it, vi } from "vitest";
import { raceWithTimeout, raceWithSignal } from "./race.js";

describe("raceWithTimeout", () => {
  it("resolves with the real promise's value when it wins, and clears the timer (no dangling setTimeout)", async () => {
    vi.useFakeTimers();
    try {
      const real = Promise.resolve("real value");
      const onTimeout = vi.fn(() => "timeout value");
      const result = await raceWithTimeout(real, 1_000, onTimeout);
      expect(result).toBe("real value");
      expect(onTimeout).not.toHaveBeenCalled();
      // If the timer weren't cleared, this would still be pending — confirm none are.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves with onTimeout()'s value when the timeout wins, and clears no leftover timer", async () => {
    vi.useFakeTimers();
    try {
      const real = new Promise<string>(() => {}); // never resolves
      const promise = raceWithTimeout(real, 1_000, () => "timeout value");
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;
      expect(result).toBe("timeout value");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave a pending timer running after the real promise wins (regression for the uncleared-timer bug)", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    await raceWithTimeout(Promise.resolve(1), 50, () => 2);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it("rejects (rather than hanging forever) when onTimeout itself throws synchronously — the 'reject on timeout' usage", async () => {
    vi.useFakeTimers();
    try {
      const real = new Promise<string>(() => {}); // never resolves
      const promise = raceWithTimeout(real, 1_000, () => {
        throw new Error("did not resolve in time");
      });
      const assertion = expect(promise).rejects.toThrow("did not resolve in time");
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("raceWithSignal", () => {
  it("resolves with the real promise's value when no signal is given", async () => {
    const result = await raceWithSignal(Promise.resolve("value"), undefined, () => "aborted");
    expect(result).toBe("value");
  });

  it("resolves with the real promise's value when the signal never fires", async () => {
    const controller = new AbortController();
    const result = await raceWithSignal(Promise.resolve("value"), controller.signal, () => "aborted");
    expect(result).toBe("value");
  });

  it("resolves with onAbort()'s value the moment the signal fires, even if the real promise never resolves", async () => {
    const controller = new AbortController();
    const real = new Promise<string>(() => {}); // never resolves — the exact shape of the reproduced bug
    const promise = raceWithSignal(real, controller.signal, () => "aborted value");
    controller.abort();
    const result = await promise;
    expect(result).toBe("aborted value");
  });

  it("resolves immediately with onAbort()'s value if the signal is already aborted before the call", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await raceWithSignal(new Promise<string>(() => {}), controller.signal, () => "already aborted");
    expect(result).toBe("already aborted");
  });

  it("removes its abort listener once the real promise wins, so a later abort() on the same controller is a no-op", async () => {
    const controller = new AbortController();
    const onAbort = vi.fn(() => "aborted");
    await raceWithSignal(Promise.resolve("value"), controller.signal, onAbort);
    controller.abort();
    expect(onAbort).not.toHaveBeenCalled();
  });
});
