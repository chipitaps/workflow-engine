"use server";

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { enqueueRun } from "@/engine/queue";
import { describeIssue, workflowSchema } from "@/engine/types";

export type FormState = { error?: string };

const uuid = z.uuid();

export async function saveWorkflow(_previous: FormState, form: FormData): Promise<FormState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return { error: "The workflow could not be read. Reload the page and try again." };
  }
  const parsed = workflowSchema.safeParse(payload);
  if (!parsed.success) return { error: describeIssue(parsed.error) };

  const { name, triggerType, steps } = parsed.data;
  const intervalMinutes = triggerType === "schedule" ? parsed.data.intervalMinutes : null;
  const id = String(form.get("id") ?? "");
  let target = id;

  if (id) {
    if (!uuid.safeParse(id).success) return { error: "That workflow no longer exists." };
    const [updated] = await db()
      .update(workflows)
      .set({
        name,
        triggerType,
        intervalMinutes,
        steps,
        updatedAt: sql`now()`,
        webhookToken:
          triggerType === "webhook"
            ? sql`coalesce(${workflows.webhookToken}, ${randomBytes(18).toString("base64url")})`
            : null,
        nextRunAt:
          triggerType === "schedule" ? sql`now() + make_interval(mins => ${intervalMinutes})` : null,
      })
      .where(eq(workflows.id, id))
      .returning({ id: workflows.id });
    if (!updated) return { error: "That workflow no longer exists." };
  } else {
    const [created] = await db()
      .insert(workflows)
      .values({
        name,
        triggerType,
        intervalMinutes,
        steps,
        webhookToken: triggerType === "webhook" ? randomBytes(18).toString("base64url") : null,
        nextRunAt: triggerType === "schedule" ? sql`now() + make_interval(mins => ${intervalMinutes})` : null,
      })
      .returning({ id: workflows.id });
    target = created.id;
  }

  revalidatePath("/");
  redirect(`/workflows/${target}?saved=1`);
}

export async function runNow(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuid.safeParse(id).success) return;
  const [workflow] = await db()
    .select({ id: workflows.id, steps: workflows.steps })
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);
  if (!workflow) return;
  const runId = await enqueueRun(db(), workflow, { type: "manual", firedAt: new Date().toISOString() });
  redirect(`/runs/${runId}`);
}

export async function toggleWorkflow(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuid.safeParse(id).success) return;
  await db()
    .update(workflows)
    .set({
      enabled: sql`not ${workflows.enabled}`,
      nextRunAt: sql`case
        when ${workflows.triggerType} = 'schedule' and not ${workflows.enabled}
          then now() + make_interval(mins => ${workflows.intervalMinutes})
        else ${workflows.nextRunAt}
      end`,
    })
    .where(eq(workflows.id, id));
  revalidatePath("/");
  revalidatePath(`/workflows/${id}`);
}

export async function deleteWorkflow(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuid.safeParse(id).success) return;
  await db().delete(workflows).where(eq(workflows.id, id));
  revalidatePath("/");
  redirect("/");
}
