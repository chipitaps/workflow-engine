import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { closeDb, db } from "../db";
import { startWorker } from "../engine/worker";

const workerId = `${hostname()}-${randomUUID().slice(0, 8)}`;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);

const worker = startWorker({
  database: db(),
  workerId,
  concurrency,
  log: (message) => console.log(`[${new Date().toISOString()}] ${message}`),
});
console.log(`Worker ${workerId} started with ${concurrency} slot(s)`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, finishing in-flight steps`);
    await worker.stop();
    await closeDb();
    process.exit(0);
  });
}
