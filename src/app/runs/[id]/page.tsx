import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { runNow } from "@/app/actions";
import AutoRefresh from "@/components/AutoRefresh";
import { runStatusName } from "@/components/RunTable";
import Status from "@/components/Status";
import { duration, relativeTime } from "@/lib/format";
import { getRun } from "@/lib/queries";

export const metadata: Metadata = { title: "Run" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="mt-2">
      <summary className="text-xs text-ink-2 hover:text-ink">{label}</summary>
      <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-wash p-3 font-mono text-xs leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export default async function RunPage(props: PageProps<"/runs/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const found = await getRun(id);
  if (!found) notFound();

  const { run, workflowName, stepRuns } = found;
  const active = run.status === "running" || run.status === "queued";
  const pending = run.steps.slice(active ? run.cursor : run.steps.length);
  const statusName = runStatusName(run);
  const waiting = statusName === "waiting";

  return (
    <div className="space-y-8">
      <AutoRefresh active={active} everyMs={1200} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-2">
            <Link href={`/workflows/${run.workflowId}`} className="underline underline-offset-4 hover:text-ink">
              {workflowName}
            </Link>
            {" · "}
            {run.trigger.type} trigger · started {relativeTime(run.createdAt)}
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">
            Run <span className="font-mono text-lg text-ink-2">{run.id.slice(0, 8)}</span>
          </h1>
        </div>
        <form action={runNow}>
          <input type="hidden" name="id" value={run.workflowId} />
          <button className="button button-quiet">Run workflow again</button>
        </form>
      </header>

      <section className="flex flex-wrap gap-x-10 gap-y-3 border-y border-line py-4 text-sm">
        <div>
          <p className="text-ink-2">Status</p>
          <Status name={statusName} />
        </div>
        <div>
          <p className="text-ink-2">Progress</p>
          <p className="font-mono tabular-nums">
            {Math.min(run.cursor, run.steps.length)}/{run.steps.length} steps
          </p>
        </div>
        <div>
          <p className="text-ink-2">Took</p>
          <p className="font-mono tabular-nums">
            {run.startedAt && run.finishedAt ? duration(run.finishedAt.getTime() - run.startedAt.getTime()) : "—"}
          </p>
        </div>
        {waiting && (
          <div>
            <p className="text-ink-2">Resumes</p>
            <p>{relativeTime(run.runAt)}</p>
          </div>
        )}
      </section>

      {run.status === "failed" && run.error && (
        <p role="alert" className="rounded-md border border-line px-4 py-3 text-sm">
          <span className="font-medium">Failed at step {run.cursor + 1}:</span> {run.error}
        </p>
      )}

      <section>
        <h2 className="text-sm font-medium">Timeline</h2>
        <ol className="mt-3 space-y-2">
          {stepRuns.map((step) => (
            <li key={step.id} className="rounded-lg border border-line px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-ink-3 tabular-nums">{step.stepIndex + 1}</span>
                  <span className="font-mono text-sm">{step.stepId}</span>
                  <span className="text-xs text-ink-3">{step.type}</span>
                  {step.attempt > 1 && <span className="text-xs text-ink-3">attempt {step.attempt}</span>}
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs text-ink-3 tabular-nums">{duration(step.durationMs)}</span>
                  <Status name={step.status} />
                </div>
              </div>
              {step.error && <p className="mt-2 text-sm text-ink-2">{step.error}</p>}
              <Json label="Input" value={step.input} />
              <Json label="Output" value={step.output} />
            </li>
          ))}
          {pending.map((step, offset) => (
            <li
              key={step.id}
              className="flex items-center justify-between rounded-lg border border-dashed border-line px-4 py-3 text-ink-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm tabular-nums">{run.cursor + offset + 1}</span>
                <span className="font-mono text-sm">{step.id}</span>
                <span className="text-xs">{step.type}</span>
              </div>
              <span className="text-sm">
                {offset === 0 ? (waiting ? `Scheduled ${relativeTime(run.runAt)}` : "Up next") : "Pending"}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-sm font-medium">Trigger data</h2>
        <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-wash p-3 font-mono text-xs leading-relaxed">
          {JSON.stringify(run.trigger, null, 2)}
        </pre>
      </section>
    </div>
  );
}
