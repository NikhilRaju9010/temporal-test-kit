import { describe, expect, it, vi } from "vitest";
import { raceWithTimeout } from "./race.js";

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
});
