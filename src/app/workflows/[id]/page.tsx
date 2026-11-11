import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { deleteWorkflow, runNow, toggleWorkflow } from "@/app/actions";
import AutoRefresh from "@/components/AutoRefresh";
import RunTable from "@/components/RunTable";
import WorkflowEditor from "@/components/WorkflowEditor";
import { everyLabel, relativeTime } from "@/lib/format";
import { getWorkflow, listRuns } from "@/lib/queries";

export const metadata: Metadata = { title: "Workflow" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WorkflowPage(props: PageProps<"/workflows/[id]">) {
  const { id } = await props.params;
  const { saved } = await props.searchParams;
  if (!UUID.test(id)) notFound();

  const [workflow, runs] = await Promise.all([getWorkflow(id), listRuns({ workflowId: id, limit: 15 })]);
  if (!workflow) notFound();

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const hookUrl = workflow.webhookToken ? `${protocol}://${host}/api/hooks/${workflow.webhookToken}` : null;
  const busy = runs.some((run) => run.status === "running" || run.status === "queued");

  return (
    <div className="space-y-10">
      <AutoRefresh active={busy} everyMs={2000} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-2">
            {workflow.enabled ? "Active" : "Paused"}
            {workflow.triggerType === "schedule" && workflow.intervalMinutes && workflow.nextRunAt && workflow.enabled
              ? ` · runs ${everyLabel(workflow.intervalMinutes)}, next ${relativeTime(workflow.nextRunAt)}`
              : ""}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{workflow.name}</h1>
        </div>
        <div className="flex gap-2">
          <form action={toggleWorkflow}>
            <input type="hidden" name="id" value={workflow.id} />
            <button className="button button-quiet">{workflow.enabled ? "Pause" : "Resume"}</button>
          </form>
          <form action={runNow}>
            <input type="hidden" name="id" value={workflow.id} />
            <button className="button button-primary">Run now</button>
          </form>
        </div>
      </header>

      {saved === "1" && (
        <p role="status" className="rounded-md border border-line bg-wash px-4 py-2 text-sm">
          Saved. Runs already in progress keep the steps they started with.
        </p>
      )}

      {hookUrl && (
        <section className="rounded-lg border border-line p-5">
          <h2 className="text-sm font-medium">Webhook</h2>
          <p className="mt-1 text-sm text-ink-2">
            Send a POST request with a JSON body to start a run. The token in the URL is the secret.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-wash p-3 font-mono text-xs leading-relaxed">
            {`curl -X POST ${hookUrl} \\\n  -H "content-type: application/json" \\\n  -d '{"name": "Ada", "email": "ada@example.com", "plan": "pro"}'`}
          </pre>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium">Recent runs</h2>
        <RunTable runs={runs} />
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium">Definition</h2>
        {workflow.slug && (
          <p className="mb-4 max-w-prose text-sm text-ink-2">
            Provisioned from the definition file <code className="font-mono text-ink">{workflow.slug}</code>. Changes
            made here are replaced the next time the definitions are applied.
          </p>
        )}
        <WorkflowEditor
          key={workflow.updatedAt.toISOString()}
          workflow={{
            id: workflow.id,
            name: workflow.name,
            triggerType: workflow.triggerType,
            intervalMinutes: workflow.intervalMinutes,
            steps: workflow.steps,
          }}
        />
      </section>

      <section className="border-t border-line pt-6">
        <form action={deleteWorkflow}>
          <input type="hidden" name="id" value={workflow.id} />
          <button className="text-sm text-ink-2 underline underline-offset-4 hover:text-(--critical)">
            Delete this workflow and its run history
          </button>
        </form>
      </section>
    </div>
  );
}
