import type { Metadata } from "next";
import WorkflowEditor from "@/components/WorkflowEditor";

export const metadata: Metadata = { title: "New workflow" };

export default function NewWorkflowPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New workflow</h1>
      <WorkflowEditor />
    </div>
  );
}
