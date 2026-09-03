"use client";

import { useActionState, useEffect, useRef } from "react";
import { addTestScoreAction, type FormResult } from "@/app/actions/profile";
import { TEST_SCORE_KINDS, TEST_SCORE_KIND_LABELS } from "@/lib/validation/enums";
import { Field, Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export function AddTestScoreForm() {
  const [state, action] = useActionState<FormResult, FormData>(
    addTestScoreAction,
    undefined,
  );
  const fe = state?.fieldErrors ?? {};
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs after a successful add.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6"
      noValidate
    >
      <Field label="Type" htmlFor="kind" error={fe.kind}>
        <Select id="kind" name="kind" defaultValue="sat">
          {TEST_SCORE_KINDS.map((k) => (
            <option key={k} value={k}>
              {TEST_SCORE_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Label"
        htmlFor="label"
        error={fe.label}
        hint="Blank defaults to the test name — only needed for subject tests like AP or GCSE."
      >
        <Input id="label" name="label" placeholder="e.g. Math HL" />
      </Field>

      <Field label="Score" htmlFor="score" error={fe.score}>
        <Input id="score" name="score" placeholder="e.g. 7 / 1500 / A*" />
      </Field>

      <Field label="Max" htmlFor="maxScore" error={fe.maxScore}>
        <Input id="maxScore" name="maxScore" placeholder="e.g. 1600" />
      </Field>

      <Field label="Date" htmlFor="takenOn" error={fe.takenOn}>
        <Input id="takenOn" name="takenOn" type="date" />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="predicted" className="h-4 w-4" />
          Predicted
        </label>
        <SubmitButton pendingText="Adding…">Add</SubmitButton>
      </div>
    </form>
  );
}
