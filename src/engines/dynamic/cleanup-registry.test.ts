import { describe, expect, it } from "vitest";
import { registerCleanup, runAllCleanups } from "./cleanup-registry.js";

describe("cleanup registry", () => {
  it("runs every registered cleanup when runAllCleanups is called", async () => {
    let a = false;
    let b = false;
    registerCleanup(() => {
      a = true;
    });
    registerCleanup(() => {
      b = true;
    });

    await runAllCleanups();

    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  it("does not run a cleanup after it has been unregistered", async () => {
    let ran = false;
    const unregister = registerCleanup(() => {
      ran = true;
    });
    unregister();

    await runAllCleanups();

    expect(ran).toBe(false);
  });

  it("runs a cleanup that returns a promise to completion before resolving", async () => {
    let done = false;
    registerCleanup(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      done = true;
    });

    await runAllCleanups();

    expect(done).toBe(true);
  });

  it("still runs the remaining cleanups if one of them throws", async () => {
    let ranAfterThrow = false;
    registerCleanup(() => {
      throw new Error("boom");
    });
    registerCleanup(() => {
      ranAfterThrow = true;
    });

    await runAllCleanups();

    expect(ranAfterThrow).toBe(true);
  });

  it("clears the registry after running, so a second call runs nothing new", async () => {
    let count = 0;
    registerCleanup(() => {
      count += 1;
    });

    await runAllCleanups();
    await runAllCleanups();

    expect(count).toBe(1);
  });
});
