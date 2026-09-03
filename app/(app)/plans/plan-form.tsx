"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { FormResult } from "@/app/actions/profile";
import {
  RESUME_ITEM_TYPES,
  RESUME_ITEM_TYPE_LABELS,
} from "@/lib/validation/enums";
import { Field, Input, Textarea, Select, FormError } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export type PlanFormValues = {
  type: string;
  title: string;
  org: string;
  description: string;
  targetDate: string;
  hoursPerWeek: string;
};

const empty: PlanFormValues = {
  type: "extracurricular",
  title: "",
  org: "",
  description: "",
  targetDate: "",
  hoursPerWeek: "",
};

export function PlanForm({
  action,
  values = empty,
  submitLabel,
  timeframeHint,
  returnToEvaluationId,
}: {
  action: (prev: FormResult, fd: FormData) => Promise<FormResult>;
  values?: PlanFormValues;
  submitLabel: string;
  /**
   * What the evaluation said about WHEN, e.g. "This term".
   *
   * Shown beside the date field rather than converted into one. The model gives
   * prose, the field wants a calendar date, and translating between them is a
   * guess about this student's school year — so the student translates it and
   * the app just makes sure they can see what was suggested while they do.
   */
  timeframeHint?: string;
  /**
   * The evaluation this was drafted from, so saving can return there.
   *
   * Travels as a hidden field rather than being read from the URL in the
   * action, because a server action has no access to the page's query string —
   * it only ever sees the form.
   */
  returnToEvaluationId?: string;
}) {
  const [state, formAction] = useActionState<FormResult, FormData>(
    action,
    undefined,
  );
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {returnToEvaluationId && (
        <input type="hidden" name="from" value={returnToEvaluationId} />
      )}
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

        <Field
          label="What do you plan to do?"
          htmlFor="title"
          error={fe.title}
        >
          <Input
            id="title"
            name="title"
            defaultValue={values.title}
            placeholder="e.g. Start a competitive programming club"
          />
        </Field>

        <Field
          label="Organisation"
          htmlFor="org"
          error={fe.org}
          hint="Where it would happen, if you know."
        >
          <Input
            id="org"
            name="org"
            defaultValue={values.org}
            placeholder="e.g. school, local lab, online"
          />
        </Field>

        <Field
          label="Target date"
          htmlFor="targetDate"
          error={fe.targetDate}
          hint={
            timeframeHint
              ? `Your evaluation suggested: ${timeframeHint}`
              : "When you'd start, or the deadline you're working to."
          }
        >
          <Input
            id="targetDate"
            name="targetDate"
            type="date"
            defaultValue={values.targetDate}
          />
        </Field>

        <Field
          label="Hours per week"
          htmlFor="hoursPerWeek"
          error={fe.hoursPerWeek}
          hint="Roughly. An hour a week is normal for a club and counts fine."
        >
          <Input
            id="hoursPerWeek"
            name="hoursPerWeek"
            type="number"
            step="0.5"
            min="0"
            defaultValue={values.hoursPerWeek}
            placeholder="e.g. 2"
          />
        </Field>
      </div>

      <Field
        label="What would you actually do?"
        htmlFor="description"
        error={fe.description}
        hint="The more concrete you are, the more useful the projection. What would you produce, how long would you keep it up, what role would you have?"
      >
        <Textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={values.description}
          placeholder="e.g. Run it weekly through the school year, enter a team in two regional contests, and publish the practice problems we write."
        />
      </Field>

      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
        <Link
          href="/plans"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
