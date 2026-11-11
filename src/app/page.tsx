import Link from "next/link";
import { runNow, toggleWorkflow } from "@/app/actions";
import AutoRefresh from "@/components/AutoRefresh";
import Status from "@/components/Status";
import { everyLabel, relativeTime } from "@/lib/format";
import { listWorkflows } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const workflows = await listWorkflows();
  const busy = workflows.some((workflow) => workflow.lastStatus === "running" || workflow.lastStatus === "queued");

  return (
    <div className="space-y-6">
      <AutoRefresh active={busy} everyMs={2500} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-2">
            {workflows.length} {workflows.length === 1 ? "workflow" : "workflows"}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        </div>
        <Link href="/workflows/new" className="button button-primary">
          New workflow
        </Link>
      </header>

      {workflows.length === 0 ? (
        <p className="rounded-lg border border-line p-8 text-sm text-ink-2">
          No workflows yet. Create one to chain HTTP requests, filters and delays behind a webhook or a schedule.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {workflows.map((workflow) => (
            <li key={workflow.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/workflows/${workflow.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {workflow.name}
                </Link>
                <p className="mt-0.5 text-sm text-ink-2">
                  {workflow.triggerType === "schedule" && workflow.intervalMinutes
                    ? `Runs ${everyLabel(workflow.intervalMinutes)}`
                    : workflow.triggerType === "webhook"
                      ? "Starts from a webhook"
                      : "Started manually"}
                  {" · "}
                  {workflow.stepCount} {workflow.stepCount === 1 ? "step" : "steps"}
                  {!workflow.enabled && " · paused"}
                </p>
              </div>
              <div className="w-44 text-sm">
                {workflow.lastStatus ? (
                  <>
                    <Status name={workflow.lastStatus} />
                    <p className="text-xs text-ink-3">
                      {workflow.lastRunAt && relativeTime(new Date(workflow.lastRunAt))} · {workflow.runCount}{" "}
                      {workflow.runCount === 1 ? "run" : "runs"}
                    </p>
                  </>
                ) : (
                  <span className="text-ink-3">Never run</span>
                )}
              </div>
              <div className="flex gap-2">
                <form action={toggleWorkflow}>
                  <input type="hidden" name="id" value={workflow.id} />
                  <button className="button button-quiet" aria-pressed={!workflow.enabled}>
                    {workflow.enabled ? "Pause" : "Resume"}
                  </button>
                </form>
                <form action={runNow}>
                  <input type="hidden" name="id" value={workflow.id} />
                  <button className="button button-quiet">Run now</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
