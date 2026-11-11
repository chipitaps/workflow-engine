import type { Metadata } from "next";
import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import RunTable from "@/components/RunTable";
import type { RunStatus } from "@/db/schema";
import { listRuns } from "@/lib/queries";

export const metadata: Metadata = { title: "Runs" };

const FILTERS: { value: RunStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "stopped", label: "Stopped" },
];

export default async function RunsPage(props: PageProps<"/runs">) {
  const { status } = await props.searchParams;
  const active = FILTERS.find((filter) => filter.value !== "" && filter.value === status)?.value || undefined;
  const runs = await listRuns({ status: active, limit: 100 });
  const busy = runs.some((run) => run.status === "running" || run.status === "queued");

  return (
    <div className="space-y-6">
      <AutoRefresh active={busy} everyMs={2500} />
      <header>
        <p className="text-sm text-ink-2">Latest {runs.length}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
      </header>
      <nav className="flex flex-wrap gap-1 text-sm" aria-label="Filter by status">
        {FILTERS.map((filter) => {
          const current = (active ?? "") === filter.value;
          return (
            <Link
              key={filter.label}
              href={filter.value ? `/runs?status=${filter.value}` : "/runs"}
              aria-current={current ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 ${current ? "bg-wash font-medium" : "text-ink-2 hover:bg-wash"}`}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>
      <RunTable runs={runs} showWorkflow />
    </div>
  );
}
