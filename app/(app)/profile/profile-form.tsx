"use client";

import { useActionState } from "react";
import { updateProfileAction, type FormResult } from "@/app/actions/profile";
import { CURRICULA, CURRICULUM_LABELS } from "@/lib/validation/enums";
import { COUNTRIES } from "@/lib/data/countries";
import {
  Field,
  Input,
  Textarea,
  Select,
  FormError,
  FormSuccess,
} from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export type ProfileFormValues = {
  gradeLevel: string | null;
  schoolName: string | null;
  schoolContext: string | null;
  curriculum: string | null;
  gpa: number | null;
  gpaScale: string | null;
  intendedMajor: string | null;
  careerGoal: string | null;
  countryOfOrigin: string | null;
};

export function ProfileForm({ values }: { values: ProfileFormValues }) {
  const [state, action] = useActionState<FormResult, FormData>(
    updateProfileAction,
    undefined,
  );
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      {state?.ok && <FormSuccess message={state.message} />}
      <FormError message={state?.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Grade level" htmlFor="gradeLevel" error={fe.gradeLevel}>
          <Input
            id="gradeLevel"
            name="gradeLevel"
            defaultValue={values.gradeLevel ?? ""}
            placeholder="e.g. Grade 11 / Year 12"
          />
        </Field>

        <Field label="School" htmlFor="schoolName" error={fe.schoolName}>
          <Input
            id="schoolName"
            name="schoolName"
            defaultValue={values.schoolName ?? ""}
            placeholder="e.g. Riverside High School"
          />
        </Field>

        <Field label="Curriculum" htmlFor="curriculum" error={fe.curriculum}>
          <Select
            id="curriculum"
            name="curriculum"
            defaultValue={values.curriculum ?? ""}
          >
            <option value="">Not set</option>
            {CURRICULA.map((c) => (
              <option key={c} value={c}>
                {CURRICULUM_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="GPA"
          htmlFor="gpa"
          error={fe.gpa}
          hint="Leave blank if not applicable (e.g. UK applicants)."
        >
          <Input
            id="gpa"
            name="gpa"
            type="number"
            step="0.01"
            min="0"
            defaultValue={values.gpa ?? ""}
            placeholder="e.g. 3.9"
          />
        </Field>

        <Field
          label="GPA scale"
          htmlFor="gpaScale"
          error={fe.gpaScale}
          hint='e.g. "4.0", or "45" for IB.'
        >
          <Input
            id="gpaScale"
            name="gpaScale"
            defaultValue={values.gpaScale ?? ""}
            placeholder="4.0"
          />
        </Field>

        <Field
          label="Intended major"
          htmlFor="intendedMajor"
          error={fe.intendedMajor}
        >
          <Input
            id="intendedMajor"
            name="intendedMajor"
            defaultValue={values.intendedMajor ?? ""}
            placeholder="e.g. Computer Science"
          />
        </Field>

        <Field label="Career goal" htmlFor="careerGoal" error={fe.careerGoal}>
          <Input
            id="careerGoal"
            name="careerGoal"
            defaultValue={values.careerGoal ?? ""}
            placeholder="e.g. AI researcher"
          />
        </Field>

        <Field
          label="Country of origin"
          htmlFor="countryOfOrigin"
          error={fe.countryOfOrigin}
          hint="Affects domestic vs international admissions."
        >
          <Select
            id="countryOfOrigin"
            name="countryOfOrigin"
            defaultValue={values.countryOfOrigin ?? ""}
          >
            <option value="">Not set</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="About your school"
        htmlFor="schoolContext"
        error={fe.schoolContext}
        hint="What's actually available to you: which advanced courses your school offers (and which it doesn't), how it grades, whether it ranks. A GPA can't be judged fairly without this — the same number means different things at different schools."
      >
        <Textarea
          id="schoolContext"
          name="schoolContext"
          rows={4}
          defaultValue={values.schoolContext ?? ""}
          placeholder="e.g. Small state school, offers 8 APs but no IB. No Further Maths available. Grades on an unweighted 4.0 scale and does not rank."
        />
      </Field>

      <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
    </form>
  );
}
