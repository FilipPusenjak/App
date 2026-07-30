import Link from "next/link";
import { notFound } from "next/navigation";
import { findOwnedPlannedItem } from "@/lib/ownership";
import { updatePlanAction } from "@/app/actions/plan";
import { PlanForm, type PlanFormValues } from "../plan-form";

export default async function EditPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plan = await findOwnedPlannedItem(id);
  if (!plan) notFound();

  const values: PlanFormValues = {
    type: plan.type,
    title: plan.title,
    org: plan.org ?? "",
    description: plan.description ?? "",
    targetDate: plan.targetDate
      ? plan.targetDate.toISOString().slice(0, 10)
      : "",
    hoursPerWeek: plan.hoursPerWeek != null ? String(plan.hoursPerWeek) : "",
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/plans"
        className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← Back to plans
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit plan</h1>
      </div>
      <PlanForm
        action={updatePlanAction.bind(null, id)}
        values={values}
        submitLabel="Save changes"
      />
    </div>
  );
}
