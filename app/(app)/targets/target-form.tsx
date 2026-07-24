"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { FormResult } from "@/app/actions/profile";
import { CLASSIFICATIONS, CLASSIFICATION_LABELS } from "@/lib/validation/enums";
import { COUNTRIES } from "@/lib/data/countries";
import { Field, Input, Textarea, Select, FormError } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export type TargetFormValues = {
  name: string;
  country: string;
  course: string;
  classification: string;
  priority: string;
  notes: string;
};

const empty: TargetFormValues = {
  name: "",
  country: "US",
  course: "",
  classification: "match",
  priority: "",
  notes: "",
};

export function TargetForm({
  action,
  values = empty,
  submitLabel,
}: {
  action: (prev: FormResult, fd: FormData) => Promise<FormResult>;
  values?: TargetFormValues;
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
        <Field label="School / university" htmlFor="name" error={fe.name}>
          <Input
            id="name"
            name="name"
            defaultValue={values.name}
            placeholder="e.g. University of Cambridge"
          />
        </Field>

        <Field
          label="Country"
          htmlFor="country"
          error={fe.country}
          hint="Drives which admissions rubric the AI applies."
        >
          <Select id="country" name="country" defaultValue={values.country}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Course / major"
          htmlFor="course"
          error={fe.course}
          hint="Especially important for UK course-specific admissions."
        >
          <Input
            id="course"
            name="course"
            defaultValue={values.course}
            placeholder="e.g. Computer Science"
          />
        </Field>

        <Field
          label="Classification"
          htmlFor="classification"
          error={fe.classification}
        >
          <Select
            id="classification"
            name="classification"
            defaultValue={values.classification}
          >
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {CLASSIFICATION_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Priority"
          htmlFor="priority"
          error={fe.priority}
          hint="Optional ranking (1 = top choice)."
        >
          <Input
            id="priority"
            name="priority"
            type="number"
            min="1"
            max="99"
            defaultValue={values.priority}
            placeholder="e.g. 1"
          />
        </Field>
      </div>

      <Field
        label="Notes"
        htmlFor="notes"
        error={fe.notes}
        hint="Optional — anything specific about this target (tests required, deadlines…)."
      >
        <Textarea id="notes" name="notes" rows={3} defaultValue={values.notes} />
      </Field>

      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
        <Link
          href="/targets"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
