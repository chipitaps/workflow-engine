import type { Database } from "../db";
import type { Run } from "../db/schema";
import { executeStep, type Dependencies } from "./execute";
import { claimRun, completeRun, enqueueDueSchedules, loadContext, recordStep } from "./queue";
import { advance } from "./state";

export async function processRun(database: Database, claimed: Run, workerId: string, deps: Dependencies = {}) {
  let run: Run | null = claimed;
  while (run) {
    if (run.cursor >= run.steps.length) {
      await completeRun(database, run, workerId);
      return;
    }
    const step = run.steps[run.cursor];
    const context = await loadContext(database, run);
    const startedAt = new Date();
    const clock = performance.now();
    const result = await executeStep(step, context, deps);
    const transition = advance(
      { cursor: run.cursor, attempt: run.attempt, totalSteps: run.steps.length },
      result.outcome,
    );
    run = await recordStep(database, run, workerId, {
      step,
      result,
      transition,
      startedAt,
      durationMs: Math.round(performance.now() - clock),
    });
  }
}

export type WorkerOptions = {
  database: Database;
  workerId: string;
  concurrency?: number;
  pollMs?: number;
  deps?: Dependencies;
  log?: (message: string) => void;
};

export function startWorker({ database, workerId, concurrency = 4, pollMs = 500, deps, log = () => undefined }: WorkerOptions) {
  let stopping = false;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loop(slot: number) {
    const id = `${workerId}#${slot}`;
    while (!stopping) {
      try {
        if (slot === 0) {
          const fired = await enqueueDueSchedules(database);
          if (fired > 0) log(`Enqueued ${fired} scheduled run(s)`);
        }
        const run = await claimRun(database, id);
        if (!run) {
          await sleep(pollMs);
          continue;
        }
        log(`Run ${run.id} claimed at step ${run.cursor + 1}/${run.steps.length} (attempt ${run.attempt})`);
        await processRun(database, run, id, deps);
      } catch (error) {
        log(`Worker loop error: ${error instanceof Error ? error.message : String(error)}`);
        await sleep(pollMs * 4);
      }
    }
  }

  const loops = Array.from({ length: concurrency }, (_, slot) => loop(slot));
  return {
    async stop() {
      stopping = true;
      await Promise.all(loops);
    },
  };
}
