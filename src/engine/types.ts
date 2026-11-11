import { z } from "zod";

export const OPERATORS = ["equals", "not_equals", "contains", "greater_than", "less_than", "exists"] as const;
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const STEP_TYPES = ["http", "transform", "filter", "delay"] as const;

export const MAX_STEPS = 20;
export const MAX_DELAY_SECONDS = 3600;

const id = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,29}$/, "Step ids start with a letter and use lowercase letters, numbers and underscores.");

const template = z.string().max(4000);

const httpStep = z.object({
  id,
  type: z.literal("http"),
  method: z.enum(METHODS),
  url: template.min(1, "The request needs a URL."),
  headers: z.record(z.string().max(100), template).default({}),
  body: template.default(""),
});

const transformStep = z.object({
  id,
  type: z.literal("transform"),
  values: z
    .record(z.string().trim().min(1).max(60), template)
    .refine((values) => Object.keys(values).length > 0, "Add at least one value."),
});

const filterStep = z.object({
  id,
  type: z.literal("filter"),
  left: template.min(1, "The filter needs a value to check."),
  operator: z.enum(OPERATORS),
  right: template.default(""),
});

const delayStep = z.object({
  id,
  type: z.literal("delay"),
  seconds: z.coerce
    .number()
    .int("Use whole seconds.")
    .min(1, "Wait at least 1 second.")
    .max(MAX_DELAY_SECONDS, `Wait at most ${MAX_DELAY_SECONDS} seconds.`),
});

export const stepSchema = z.discriminatedUnion("type", [httpStep, transformStep, filterStep, delayStep]);

export const stepsSchema = z
  .array(stepSchema)
  .min(1, "Add at least one step.")
  .max(MAX_STEPS, `A workflow can have at most ${MAX_STEPS} steps.`)
  .superRefine((steps, context) => {
    const seen = new Set<string>();
    for (const [index, step] of steps.entries()) {
      if (seen.has(step.id)) {
        context.addIssue({ code: "custom", path: [index, "id"], message: `Two steps are named "${step.id}".` });
      }
      seen.add(step.id);
    }
  });

export const workflowSchema = z
  .object({
    name: z.string().trim().min(1, "Name the workflow.").max(80),
    triggerType: z.enum(["manual", "webhook", "schedule"]),
    intervalMinutes: z.coerce.number().int().min(1).max(10080).nullable(),
    steps: stepsSchema,
  })
  .refine((workflow) => workflow.triggerType !== "schedule" || workflow.intervalMinutes !== null, {
    message: "Say how often the workflow should run.",
    path: ["intervalMinutes"],
  });

export type Step = z.infer<typeof stepSchema>;
export type HttpStep = Extract<Step, { type: "http" }>;
export type Operator = (typeof OPERATORS)[number];
export type WorkflowInput = z.infer<typeof workflowSchema>;

export type TriggerPayload = {
  type: "manual" | "webhook" | "schedule";
  firedAt: string;
  body?: unknown;
  query?: Record<string, string>;
};

export type Context = {
  trigger: TriggerPayload;
  steps: Record<string, unknown>;
  run: { id: string };
};

export function describeIssue(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "Check the workflow and try again.";
  const [root, index] = issue.path;
  return root === "steps" && typeof index === "number" ? `Step ${index + 1}: ${issue.message}` : issue.message;
}
