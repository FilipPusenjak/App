"use client";

import { useActionState } from "react";
import {
  markBriefingForwardedAction,
  type TutorResult,
} from "@/app/actions/testprep";

/**
 * The tutor's own record of having passed a briefing on.
 *
 * NOT A SEND BUTTON. Pressing it mails nothing and tells nobody — the app has no
 * route to a student's family. It writes a date so next month's screen can say
 * which briefings were forwarded and which were not, which is the sort of thing
 * a tutor otherwise keeps in their head across twenty students.
 *
 * It reads as a statement about the past ("I sent this one") rather than an
 * instruction, because that is what it records, and it can be taken back — see
 * the action for why this column toggles when a consent column never would.
 */
export function MarkForwarded({
  artifactId,
  forwarded,
}: {
  artifactId: string;
  forwarded: boolean;
}) {
  const [state, action] = useActionState<TutorResult, FormData>(
    markBriefingForwardedAction,
    {},
  );

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="artifactId" value={artifactId} />
      <button
        type="submit"
        className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-foreground"
      >
        {forwarded ? "I did not send this" : "I sent this on"}
      </button>
      {state.error && (
        <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>
      )}
    </form>
  );
}
