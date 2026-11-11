import Link from "next/link";
import { duration, relativeTime } from "@/lib/format";
import type { RunRow } from "@/lib/queries";
import Status, { type StatusName } from "./Status";

export function runStatusName(run: Pick<RunRow, "status" | "runAt">): StatusName {
  if (run.status === "queued" && run.runAt.getTime() > Date.now()) return "waiting";
  return run.status;
}

export default function RunTable({ runs, showWorkflow }: { runs: RunRow[]; showWorkflow?: boolean }) {
  if (runs.length === 0) {
    return <p className="rounded-lg border border-line p-6 text-sm text-ink-2">No runs yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-2">
            <th className="px-4 py-2.5 font-normal">Status</th>
            {showWorkflow && <th className="px-4 py-2.5 font-normal">Workflow</th>}
            <th className="px-4 py-2.5 font-normal">Trigger</th>
            <th className="px-4 py-2.5 font-normal">Progress</th>
            <th className="px-4 py-2.5 font-normal">Started</th>
            <th className="px-4 py-2.5 text-right font-normal">Took</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {runs.map((run) => (
            <tr key={run.id} className="hover:bg-wash">
              <td className="px-4 py-2.5">
                <Link href={`/runs/${run.id}`} className="underline-offset-4 hover:underline">
                  <Status name={runStatusName(run)} />
                </Link>
              </td>
              {showWorkflow && <td className="max-w-[14rem] truncate px-4 py-2.5">{run.workflowName}</td>}
              <td className="px-4 py-2.5 text-ink-2 capitalize">{run.triggerType}</td>
              <td className="px-4 py-2.5 font-mono text-ink-2 tabular-nums">
                {Math.min(run.cursor, run.totalSteps)}/{run.totalSteps}
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap text-ink-2">{relativeTime(run.createdAt)}</td>
              <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap text-ink-2 tabular-nums">
                {run.startedAt && run.finishedAt
                  ? duration(run.finishedAt.getTime() - run.startedAt.getTime())
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
