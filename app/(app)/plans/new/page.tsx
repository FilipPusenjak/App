import Link from "next/link";
import { createPlanAction } from "@/app/actions/plan";
import { PlanForm } from "../plan-form";

export default function NewPlanPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/plans"
        className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← Back to plans
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add a plan</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Something you&apos;re considering doing but haven&apos;t done yet. It
          won&apos;t count toward your scores until you mark it done.
        </p>
      </div>
      <PlanForm action={createPlanAction} submitLabel="Add plan" />
    </div>
  );
}
