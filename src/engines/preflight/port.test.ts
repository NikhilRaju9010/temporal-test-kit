import { describe, expect, it, afterEach } from "vitest";
import { createServer, Server } from "node:net";
import { checkPortAvailable } from "./port.js";

describe("checkPortAvailable", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("passes when the port is free", async () => {
    const result = await checkPortAvailable(58471);
    expect(result.passed).toBe(true);
  });

  it("fails when the port is already bound by something else", async () => {
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(58472, resolve));

    const result = await checkPortAvailable(58472);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("58472");
  });
});
