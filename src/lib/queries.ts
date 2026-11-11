import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { runs, stepRuns, workflows, type RunStatus } from "@/db/schema";

export async function listWorkflows() {
  return db()
    .select({
      id: workflows.id,
      name: workflows.name,
      enabled: workflows.enabled,
      triggerType: workflows.triggerType,
      intervalMinutes: workflows.intervalMinutes,
      nextRunAt: workflows.nextRunAt,
      stepCount: sql<number>`jsonb_array_length(${workflows.steps})`,
      lastStatus: sql<RunStatus | null>`(
        select r.status from runs r where r.workflow_id = ${workflows.id} order by r.created_at desc limit 1
      )`,
      lastRunAt: sql<string | null>`(
        select r.created_at from runs r where r.workflow_id = ${workflows.id} order by r.created_at desc limit 1
      )`,
      runCount: sql<number>`(select count(*)::int from runs r where r.workflow_id = ${workflows.id})`,
    })
    .from(workflows)
    .orderBy(asc(workflows.createdAt));
}

export async function getWorkflow(id: string) {
  const [workflow] = await db().select().from(workflows).where(eq(workflows.id, id)).limit(1);
  return workflow ?? null;
}

const runColumns = {
  id: runs.id,
  status: runs.status,
  cursor: runs.cursor,
  attempt: runs.attempt,
  totalSteps: sql<number>`jsonb_array_length(${runs.steps})`,
  triggerType: sql<string>`${runs.trigger}->>'type'`,
  error: runs.error,
  createdAt: runs.createdAt,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
  runAt: runs.runAt,
  workflowId: runs.workflowId,
  workflowName: workflows.name,
};

export async function listRuns(options: { workflowId?: string; status?: RunStatus; limit?: number } = {}) {
  const query = db().select(runColumns).from(runs).innerJoin(workflows, eq(workflows.id, runs.workflowId)).$dynamic();
  if (options.workflowId) query.where(eq(runs.workflowId, options.workflowId));
  else if (options.status) query.where(eq(runs.status, options.status));
  return query.orderBy(desc(runs.createdAt)).limit(options.limit ?? 50);
}

export async function getRun(id: string) {
  const [run] = await db()
    .select({ run: runs, workflowName: workflows.name })
    .from(runs)
    .innerJoin(workflows, eq(workflows.id, runs.workflowId))
    .where(eq(runs.id, id))
    .limit(1);
  if (!run) return null;
  const steps = await db()
    .select()
    .from(stepRuns)
    .where(eq(stepRuns.runId, id))
    .orderBy(asc(stepRuns.startedAt), asc(stepRuns.stepIndex), asc(stepRuns.attempt));
  return { ...run, stepRuns: steps };
}

export type RunRow = Awaited<ReturnType<typeof listRuns>>[number];
