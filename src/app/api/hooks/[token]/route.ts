import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { enqueueRun } from "@/engine/queue";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request, context: RouteContext<"/api/hooks/[token]">) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return Response.json({ error: "Unknown webhook." }, { status: 404 });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "The payload is larger than 64 KB." }, { status: 413 });
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return Response.json({ error: "The payload is larger than 64 KB." }, { status: 413 });
  }

  let body: unknown = text;
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  const [workflow] = await db()
    .select({ id: workflows.id, steps: workflows.steps, enabled: workflows.enabled })
    .from(workflows)
    .where(and(eq(workflows.webhookToken, token), eq(workflows.triggerType, "webhook")))
    .limit(1);
  if (!workflow) return Response.json({ error: "Unknown webhook." }, { status: 404 });
  if (!workflow.enabled) return Response.json({ error: "This workflow is paused." }, { status: 409 });

  const query = Object.fromEntries(new URL(request.url).searchParams);
  const runId = await enqueueRun(db(), workflow, {
    type: "webhook",
    firedAt: new Date().toISOString(),
    body,
    query,
  });
  return Response.json({ runId, status: "queued" }, { status: 202 });
}
