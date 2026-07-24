import Link from "next/link";
import { notFound } from "next/navigation";
import { findOwnedTargetSchool } from "@/lib/ownership";
import { updateTargetAction } from "@/app/actions/target";
import { TargetForm, type TargetFormValues } from "../target-form";

export default async function EditTargetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const target = await findOwnedTargetSchool(id);
  if (!target) notFound();

  const values: TargetFormValues = {
    name: target.name,
    country: target.country,
    course: target.course ?? "",
    classification: target.classification,
    priority: target.priority != null ? String(target.priority) : "",
    notes: target.notes ?? "",
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/targets"
        className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← Back to targets
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit target school
        </h1>
      </div>
      <TargetForm
        action={updateTargetAction.bind(null, id)}
        values={values}
        submitLabel="Save changes"
      />
    </div>
  );
}
