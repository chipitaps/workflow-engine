CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('succeeded', 'failed', 'retrying', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."trigger_type" AS ENUM('manual', 'webhook', 'schedule');--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"trigger" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "step_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"step_id" text NOT NULL,
	"type" text NOT NULL,
	"status" "step_status" NOT NULL,
	"attempt" integer NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_type" "trigger_type" NOT NULL,
	"webhook_token" text,
	"interval_minutes" integer,
	"next_run_at" timestamp with time zone,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workflows_webhook_token_unique" UNIQUE("webhook_token"),
	CONSTRAINT "workflows_interval_positive" CHECK ("workflows"."interval_minutes" is null or "workflows"."interval_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_runs" ADD CONSTRAINT "step_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_claim_idx" ON "runs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "runs_workflow_idx" ON "runs" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "step_runs_run_idx" ON "step_runs" USING btree ("run_id","step_index","attempt");--> statement-breakpoint
CREATE INDEX "workflows_schedule_idx" ON "workflows" USING btree ("next_run_at") WHERE "workflows"."trigger_type" = 'schedule';