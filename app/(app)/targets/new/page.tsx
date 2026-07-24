import Link from "next/link";
import { createTargetAction } from "@/app/actions/target";
import { TargetForm } from "../target-form";

export default function NewTargetPage() {
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
          Add a target school
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          A university you&apos;re considering applying to.
        </p>
      </div>
      <TargetForm action={createTargetAction} submitLabel="Add target" />
    </div>
  );
}
