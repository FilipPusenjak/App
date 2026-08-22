"use client";

import { useActionState } from "react";
import {
  acknowledgeStoppingAction,
  type TutorResult,
} from "@/app/actions/testprep";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Acknowledging a stopping signal.
 *
 * Required, and required as a deliberate ACT rather than a dismissal. The whole
 * reason acknowledgedByTutorAt is a column and not a piece of local state is
 * that a signal a tutor can scroll past is a signal the business case says to
 * scroll past — and the business case here is a monthly invoice.
 *
 * The button does not say "dismiss" or "got it". It says what acknowledging
 * means, because a tutor clicking it is accepting that the honest thing to tell
 * this family is that the work is done.
 */
export function AcknowledgeStopping({ signalId }: { signalId: string }) {
  const [state, action] = useActionState<TutorResult, FormData>(
    acknowledgeStoppingAction,
    {},
  );

  if (state.ok) {
    return (
      <p className="mt-3 text-xs text-emerald-800 dark:text-emerald-200">
        Acknowledged. It stays on the record either way.
      </p>
    );
  }

  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="signalId" value={signalId} />
      <SubmitButton variant="secondary" pendingText="Recording…">
        I have read this and will tell the family
      </SubmitButton>
      {state.error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </form>
  );
}
