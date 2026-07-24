"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { FormResult } from "@/app/actions/profile";
import { RESUME_ITEM_TYPES, RESUME_ITEM_TYPE_LABELS } from "@/lib/validation/enums";
import { Field, Input, Textarea, Select, FormError } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export type ItemFormValues = {
  type: string;
  title: string;
  org: string;
  startDate: string; // yyyy-mm-dd or ""
  endDate: string;
  hoursPerWeek: string;
  description: string;
  evidenceNotes: string;
};

const empty: ItemFormValues = {
  type: "extracurricular",
  title: "",
  org: "",
  startDate: "",
  endDate: "",
  hoursPerWeek: "",
  description: "",
  evidenceNotes: "",
};

export function ItemForm({
  action,
  values = empty,
  submitLabel,
}: {
  action: (prev: FormResult, fd: FormData) => Promise<FormResult>;
  values?: ItemFormValues;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormResult, FormData>(
    action,
    undefined,
  );
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormError message={state?.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="type" error={fe.type}>
          <Select id="type" name="type" defaultValue={values.type}>
            {RESUME_ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {RESUME_ITEM_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Title" htmlFor="title" error={fe.title}>
          <Input
            id="title"
            name="title"
            defaultValue={values.title}
            placeholder="e.g. Captain, Robotics Team"
          />
        </Field>

        <Field label="Organization" htmlFor="org" error={fe.org}>
          <Input
            id="org"
            name="org"
            defaultValue={values.org}
            placeholder="e.g. Riverside High School"
          />
        </Field>

        <Field
          label="Hours per week"
          htmlFor="hoursPerWeek"
          error={fe.hoursPerWeek}
        >
          <Input
            id="hoursPerWeek"
            name="hoursPerWeek"
            type="number"
            step="0.5"
            min="0"
            defaultValue={values.hoursPerWeek}
            placeholder="e.g. 8"
          />
        </Field>

        <Field label="Start date" htmlFor="startDate" error={fe.startDate}>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={values.startDate}
          />
        </Field>

        <Field
          label="End date"
          htmlFor="endDate"
          error={fe.endDate}
          hint="Leave blank if ongoing."
        >
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={values.endDate}
          />
        </Field>
      </div>

      <Field label="Description" htmlFor="description" error={fe.description}>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={values.description}
          placeholder="What you did, scope, and any measurable impact."
        />
      </Field>

      <Field
        label="Evidence notes"
        htmlFor="evidenceNotes"
        error={fe.evidenceNotes}
        hint="Optional — links, awards, references that back this up."
      >
        <Textarea
          id="evidenceNotes"
          name="evidenceNotes"
          rows={2}
          defaultValue={values.evidenceNotes}
        />
      </Field>

      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
        <Link
          href="/profile"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
