import Link from "next/link";
import { createResumeItemAction } from "@/app/actions/profile";
import { ItemForm } from "../item-form";

export default function NewItemPage() {
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
          Add a resume item
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          A single activity, award, role, project, or experience.
        </p>
      </div>
      <ItemForm action={createResumeItemAction} submitLabel="Add item" />
    </div>
  );
}
