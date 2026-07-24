import Link from "next/link";
import { notFound } from "next/navigation";
import { findOwnedResumeItem } from "@/lib/ownership";
import { updateResumeItemAction } from "@/app/actions/profile";
import { ItemForm, type ItemFormValues } from "../item-form";

function toDateInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await findOwnedResumeItem(id);
  if (!item) notFound();

  const values: ItemFormValues = {
    type: item.type,
    title: item.title,
    org: item.org ?? "",
    startDate: toDateInput(item.startDate),
    endDate: toDateInput(item.endDate),
    hoursPerWeek: item.hoursPerWeek != null ? String(item.hoursPerWeek) : "",
    description: item.description ?? "",
    evidenceNotes: item.evidenceNotes ?? "",
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/profile"
        className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← Back to profile
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit resume item
        </h1>
      </div>
      <ItemForm
        action={updateResumeItemAction.bind(null, id)}
        values={values}
        submitLabel="Save changes"
      />
    </div>
  );
}
