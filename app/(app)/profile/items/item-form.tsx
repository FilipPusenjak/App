"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { FormResult } from "@/app/actions/profile";
import { RESUME_ITEM_TYPES, RESUME_ITEM_TYPE_LABELS } from "@/lib/validation/enums";
import { Field, Input, Textarea, Select, FormError } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  COMMON_APP_ACTIVITY_TYPES,
  GRADE_LEVELS,
  gradeLabel,
  TIMING_LABELS,
  TIMINGS,
} from "@/lib/documents/limits";

export type ItemFormValues = {
  type: string;
  title: string;
  org: string;
  startDate: string; // yyyy-mm-dd or ""
  endDate: string;
  hoursPerWeek: string;
  description: string;
  evidenceNotes: string;
  commonAppType: string;
  positionTitle: string;
  gradeLevels: number[];
  timing: string;
  weeksPerYear: string;
  /** One fact per line. */
  facts: string;
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
  commonAppType: "",
  positionTitle: "",
  gradeLevels: [],
  timing: "",
  weeksPerYear: "",
  facts: "",
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

      {/* What the Common App asks for. Optional here; the application
          document builder asks for whatever is missing when it is needed. */}
      <details className="rounded-lg border border-black/10 p-4 dark:border-white/15" open={Boolean(values.commonAppType || values.facts || values.gradeLevels.length)}>
        <summary className="cursor-pointer text-sm font-medium">
          Common App details <span className="font-normal text-zinc-500">(optional)</span>
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Activity type" htmlFor="commonAppType" error={fe.commonAppType}>
              <Select id="commonAppType" name="commonAppType" defaultValue={values.commonAppType}>
                <option value="">Choose…</option>
                {COMMON_APP_ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Position or title"
              htmlFor="positionTitle"
              error={fe.positionTitle}
              hint="Only if you held one. Leave blank otherwise."
            >
              <Input id="positionTitle" name="positionTitle" defaultValue={values.positionTitle} placeholder="e.g. Treasurer" />
            </Field>
            <Field label="When" htmlFor="timing" error={fe.timing}>
              <Select id="timing" name="timing" defaultValue={values.timing}>
                <option value="">Choose…</option>
                {TIMINGS.map((t) => (
                  <option key={t} value={t}>{TIMING_LABELS[t]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Weeks per year" htmlFor="weeksPerYear" error={fe.weeksPerYear}>
              <Input id="weeksPerYear" name="weeksPerYear" type="number" min="0" max="52" step="1" defaultValue={values.weeksPerYear} placeholder="e.g. 36" />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Grades</legend>
            <div className="flex flex-wrap gap-3">
              {GRADE_LEVELS.map((g) => (
                <label key={g} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="gradeLevels" value={g} defaultChecked={values.gradeLevels.includes(g)} />
                  {g === 13 ? "Post-graduate" : gradeLabel(g)}
                </label>
              ))}
            </div>
            {fe.gradeLevels && <p className="mt-1 text-xs text-red-600">{fe.gradeLevels}</p>}
          </fieldset>
          <Field
            label="Concrete facts"
            htmlFor="facts"
            error={fe.facts}
            hint="One per line: results, numbers, things you made or presented. Generated descriptions only use what you write here and above."
          >
            <Textarea id="facts" name="facts" rows={3} defaultValue={values.facts} placeholder={"Grew the club from 11 to 34 members\nPresented at the spring science fair"} />
          </Field>
        </div>
      </details>

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
