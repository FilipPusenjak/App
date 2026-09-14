"use client";

import { useActionState } from "react";
import { recordScoreAction, type TutorResult } from "@/app/actions/testprep";
import { Field, Input, Select, FormError, FormSuccess } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ATTEMPT_KINDS, type AttemptKind } from "@/lib/validation/testprep";
import type { TestSection } from "@/lib/validation/testprep";

/**
 * Recording a sitting — the only way a score enters this product.
 *
 * SECTIONS, NOT A COMPOSITE. The form deliberately has no composite field: the
 * action computes it from the sections and from the test's own rule. A typed
 * composite that disagreed with its own sections would be a number nobody could
 * explain later, and it is the number that reaches a parent.
 *
 * It also means superscoring works. A school that reads the best section from
 * each sitting needs the sections to exist; a product that stored only "1450"
 * could never compute what that school actually sees.
 *
 * THE FIELDS ARE BUILT FROM THE TEST, not hardcoded. The SAT has two sections
 * and the ACT four, and adding a test is a data change everywhere else in this
 * edition — a form with "Reading and Writing" and "Math" typed into it would be
 * the one place that stopped being true.
 *
 * WHAT THIS DOES NOT SAY is that it is entering a verified score. The action
 * records enteredBy: TUTOR and isVerified: false, because a tutor typing a
 * number has not seen a score report, and every artifact showing that sitting
 * says so. There is no checkbox here to claim otherwise.
 */
const KIND_LABELS: Record<AttemptKind, string> = {
  DIAGNOSTIC: "Diagnostic — the first sitting, what progress is measured from",
  PRACTICE: "Practice — noisy by nature, and labelled that way wherever it shows",
  OFFICIAL: "Official — a real sitting with the testing body",
};

export function RecordScore({
  linkId,
  testTypeId,
  testName,
  sections,
}: {
  linkId: string;
  testTypeId: string;
  testName: string;
  sections: TestSection[];
}) {
  const [state, action] = useActionState<TutorResult, FormData>(
    recordScoreAction,
    {},
  );

  return (
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="linkId" value={linkId} />
      <input type="hidden" name="testTypeId" value={testTypeId} />

      {state.ok && <FormSuccess message={state.message} />}
      <FormError message={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind of sitting" htmlFor="kind">
          <Select id="kind" name="kind" defaultValue="PRACTICE">
            {ATTEMPT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Date taken" htmlFor="takenAt">
          <Input id="takenAt" name="takenAt" type="date" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <Field
            key={s.name}
            label={s.name}
            htmlFor={`section:${s.name}`}
            hint={`${s.min}–${s.max}${s.step > 1 ? `, in ${s.step}s` : ""}`}
          >
            <Input
              id={`section:${s.name}`}
              name={`section:${s.name}`}
              type="number"
              min={s.min}
              max={s.max}
              step={s.step}
              inputMode="numeric"
            />
          </Field>
        ))}
      </div>

      <div>
        <SubmitButton variant="secondary" pendingText="Recording…">
          Record this {testName} sitting
        </SubmitButton>
        {/* Said before they press it, not after. Recording a score can cross a
            student into "you are done", and a tutor should know that is what
            they are about to find out rather than discover it. */}
        <p className="mt-2 text-xs text-zinc-500">
          The composite is worked out from the sections. Recording recomputes
          the target and may change what this student is told about stopping.
        </p>
      </div>
    </form>
  );
}
