import { createServer } from "node:net";
import { PreflightResult } from "../../report/types.js";

export function checkPortAvailable(port: number): Promise<PreflightResult> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve({
        name: `port ${port} available`,
        passed: false,
        message: `Port ${port} is already in use by another process`,
      });
    });
    server.once("listening", () => {
      server.close(() => {
        resolve({
          name: `port ${port} available`,
          passed: true,
          message: `Port ${port} is free`,
        });
      });
    });
    server.listen(port);
  });
}
