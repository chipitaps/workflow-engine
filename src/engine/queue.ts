import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import { runs, stepRuns, type Run } from "../db/schema";
import type { StepResult } from "./execute";
import type { Transition } from "./state";
import type { Context, Step, TriggerPayload } from "./types";

export const LEASE_SECONDS = 60;

export async function enqueueRun(
  database: Database,
  workflow: { id: string; steps: Step[] },
  trigger: TriggerPayload,
): Promise<string> {
  const [run] = await database
    .insert(runs)
    .values({ workflowId: workflow.id, steps: workflow.steps, trigger })
    .returning({ id: runs.id });
  return run.id;
}

export async function claimRun(database: Database, workerId: string, leaseSeconds = LEASE_SECONDS): Promise<Run | null> {
  const [claimed] = await database
    .update(runs)
    .set({
      status: "running",
      lockedBy: workerId,
      lockedUntil: sql`now() + make_interval(secs => ${leaseSeconds})`,
      startedAt: sql`coalesce(${runs.startedAt}, now())`,
    })
    .where(
      eq(
        runs.id,
        sql`(
          select id from runs
          where (status = 'queued' and run_at <= now())
             or (status = 'running' and locked_until < now())
          order by run_at
          limit 1
          for update skip locked
        )`,
      ),
    )
    .returning();
  return claimed ?? null;
}

export async function enqueueDueSchedules(database: Database): Promise<number> {
  const result = await database.execute(sql`
    with due as (
      select id from workflows
      where enabled and trigger_type = 'schedule' and next_run_at <= now()
      for update skip locked
    ),
    advanced as (
      update workflows w
      set next_run_at = now() + make_interval(mins => w.interval_minutes)
      from due
      where w.id = due.id
      returning w.id, w.steps
    )
    insert into runs (workflow_id, steps, trigger)
    select id, steps, jsonb_build_object('type', 'schedule', 'firedAt', now())
    from advanced
  `);
  return result.rowCount ?? 0;
}

export async function loadContext(database: Database, run: Run): Promise<Context> {
  const completed = await database
    .select({ stepId: stepRuns.stepId, output: stepRuns.output })
    .from(stepRuns)
    .where(and(eq(stepRuns.runId, run.id), eq(stepRuns.status, "succeeded")))
    .orderBy(asc(stepRuns.stepIndex));
  return {
    trigger: run.trigger,
    steps: Object.fromEntries(completed.map((row) => [row.stepId, row.output])),
    run: { id: run.id },
  };
}

type Recorded = { step: Step; result: StepResult; transition: Transition; startedAt: Date; durationMs: number };

export async function recordStep(
  database: Database,
  run: Run,
  workerId: string,
  recorded: Recorded,
  leaseSeconds = LEASE_SECONDS,
): Promise<Run | null> {
  const { step, result, transition, startedAt, durationMs } = recorded;
  const continues = transition.status === "queued" && transition.delayMs === 0;
  const terminal = transition.status !== "queued";

  return database.transaction(async (tx) => {
    const [updated] = await tx
      .update(runs)
      .set({
        status: continues ? "running" : transition.status,
        cursor: transition.cursor,
        attempt: transition.attempt,
        error: transition.error,
        runAt: sql`now() + make_interval(secs => ${transition.delayMs / 1000})`,
        lockedBy: continues ? workerId : null,
        lockedUntil: continues ? sql`now() + make_interval(secs => ${leaseSeconds})` : null,
        finishedAt: terminal ? sql`now()` : null,
      })
      .where(and(eq(runs.id, run.id), eq(runs.lockedBy, workerId), eq(runs.status, "running")))
      .returning();
    if (!updated) return null;

    await tx.insert(stepRuns).values({
      runId: run.id,
      stepIndex: run.cursor,
      stepId: step.id,
      type: step.type,
      status: transition.stepStatus,
      attempt: run.attempt,
      input: result.input ?? null,
      output: result.output ?? null,
      error: result.outcome.kind === "error" ? result.outcome.message : null,
      startedAt,
      durationMs,
    });
    return continues ? updated : null;
  });
}

export async function completeRun(database: Database, run: Run, workerId: string) {
  await database
    .update(runs)
    .set({ status: "succeeded", lockedBy: null, lockedUntil: null, finishedAt: sql`now()` })
    .where(and(eq(runs.id, run.id), eq(runs.lockedBy, workerId)));
}
