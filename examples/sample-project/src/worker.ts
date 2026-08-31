import { Worker } from "@temporalio/worker";
import * as activities from "./activities.js";

export async function runWorker(connection: unknown, taskQueue = "default") {
  const worker = await Worker.create({
    connection: connection as never,
    taskQueue,
    workflowsPath: new URL("./workflows.js", import.meta.url).pathname,
    activities,
  });
  await worker.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { NativeConnection } = await import("@temporalio/worker");
  const connection = await NativeConnection.connect({ address: "localhost:7233" });
  await runWorker(connection);
}
