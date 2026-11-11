import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db";
import { workflows } from "../db/schema";
import { describeIssue, stepsSchema } from "./types";

const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)\}/g;

export const definitionSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,49}$/, "Slugs use lowercase letters, numbers and hyphens."),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(true),
    trigger: z.discriminatedUnion("type", [
      z.object({ type: z.literal("manual") }),
      z.object({
        type: z.literal("webhook"),
        token: z
          .string()
          .regex(/^[A-Za-z0-9_-]{16,64}$/, "Webhook tokens are 16 to 64 URL-safe characters.")
          .optional(),
      }),
      z.object({ type: z.literal("schedule"), everyMinutes: z.number().int().min(1).max(10080) }),
    ]),
    steps: stepsSchema,
  })
  .strict();

export type Definition = z.infer<typeof definitionSchema>;

export class DefinitionError extends Error {}

export function substitute(value: unknown, env: Record<string, string | undefined>): unknown {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER, (_match, name: string) => {
      const found = env[name];
      if (found === undefined || found === "") {
        throw new DefinitionError(`The environment variable ${name} is not set.`);
      }
      return found;
    });
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, env));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, env)]));
  }
  return value;
}

export function parseDefinition(source: string, env: Record<string, string | undefined>, label = "definition"): Definition {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new DefinitionError(`${label}: not valid JSON.`);
  }
  let resolved: unknown;
  try {
    resolved = substitute(raw, env);
  } catch (error) {
    throw new DefinitionError(`${label}: ${(error as Error).message}`);
  }
  const parsed = definitionSchema.safeParse(resolved);
  if (!parsed.success) throw new DefinitionError(`${label}: ${describeIssue(parsed.error)}`);
  return parsed.data;
}

export async function provision(database: Database, definitions: Definition[]) {
  const slugs = new Set<string>();
  for (const definition of definitions) {
    if (slugs.has(definition.slug)) throw new DefinitionError(`Two definitions use the slug "${definition.slug}".`);
    slugs.add(definition.slug);
  }

  for (const definition of definitions) {
    const { trigger } = definition;
    const intervalMinutes = trigger.type === "schedule" ? trigger.everyMinutes : null;
    const token = trigger.type === "webhook" ? (trigger.token ?? null) : null;
    const generated = randomBytes(18).toString("base64url");

    await database
      .insert(workflows)
      .values({
        slug: definition.slug,
        name: definition.name,
        enabled: definition.enabled,
        triggerType: trigger.type,
        steps: definition.steps,
        intervalMinutes,
        webhookToken: trigger.type === "webhook" ? (token ?? generated) : null,
        nextRunAt: intervalMinutes ? sql`now() + make_interval(mins => ${intervalMinutes})` : null,
      })
      .onConflictDoUpdate({
        target: workflows.slug,
        set: {
          name: definition.name,
          enabled: definition.enabled,
          triggerType: trigger.type,
          steps: definition.steps,
          intervalMinutes,
          updatedAt: sql`now()`,
          webhookToken:
            trigger.type !== "webhook"
              ? null
              : token
                ? token
                : sql`coalesce(${workflows.webhookToken}, ${generated})`,
          nextRunAt: intervalMinutes
            ? sql`case
                when ${workflows.triggerType} = 'schedule' and ${workflows.intervalMinutes} = ${intervalMinutes}
                  then ${workflows.nextRunAt}
                else now() + make_interval(mins => ${intervalMinutes})
              end`
            : null,
        },
      });
  }
  return definitions.length;
}
