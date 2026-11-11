import { getRun } from "@/lib/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: RouteContext<"/api/runs/[id]">) {
  const { id } = await context.params;
  const found = UUID.test(id) ? await getRun(id) : null;
  if (!found) return Response.json({ error: "Run not found." }, { status: 404 });

  const { run, stepRuns } = found;
  return Response.json({
    id: run.id,
    status: run.status,
    cursor: run.cursor,
    totalSteps: run.steps.length,
    error: run.error,
    steps: stepRuns.map((step) => ({
      id: step.stepId,
      type: step.type,
      status: step.status,
      attempt: step.attempt,
      output: step.output,
      error: step.error,
    })),
  });
}
