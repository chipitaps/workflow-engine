import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Step, TriggerPayload } from "../engine/types";

export const triggerType = pgEnum("trigger_type", ["manual", "webhook", "schedule"]);
export const runStatus = pgEnum("run_status", ["queued", "running", "succeeded", "failed", "stopped"]);
export const stepStatus = pgEnum("step_status", ["succeeded", "failed", "retrying", "stopped"]);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const workflows = pgTable(
  "workflows",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().unique(),
    name: text().notNull(),
    enabled: boolean().notNull().default(true),
    triggerType: triggerType("trigger_type").notNull(),
    webhookToken: text("webhook_token").unique(),
    intervalMinutes: integer("interval_minutes"),
    nextRunAt: timestamptz("next_run_at"),
    steps: jsonb().$type<Step[]>().notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("workflows_schedule_idx").on(table.nextRunAt).where(sql`${table.triggerType} = 'schedule'`),
    check(
      "workflows_interval_positive",
      sql`${table.intervalMinutes} is null or ${table.intervalMinutes} > 0`,
    ),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    status: runStatus().notNull().default("queued"),
    trigger: jsonb().$type<TriggerPayload>().notNull(),
    steps: jsonb().$type<Step[]>().notNull(),
    cursor: integer().notNull().default(0),
    attempt: integer().notNull().default(1),
    runAt: timestamptz("run_at").notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedUntil: timestamptz("locked_until"),
    error: text(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
  },
  (table) => [
    index("runs_claim_idx").on(table.status, table.runAt),
    index("runs_workflow_idx").on(table.workflowId, table.createdAt),
  ],
);

export const stepRuns = pgTable(
  "step_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    stepId: text("step_id").notNull(),
    type: text().notNull(),
    status: stepStatus().notNull(),
    attempt: integer().notNull(),
    input: jsonb(),
    output: jsonb(),
    error: text(),
    startedAt: timestamptz("started_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
  },
  (table) => [index("step_runs_run_idx").on(table.runId, table.stepIndex, table.attempt)],
);

export type Workflow = typeof workflows.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type StepRun = typeof stepRuns.$inferSelect;
export type RunStatus = (typeof runStatus.enumValues)[number];
export type TriggerType = (typeof triggerType.enumValues)[number];
