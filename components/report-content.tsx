"use client";

import { useActionState, useState } from "react";
import { reportContentAction } from "@/app/actions/content-report";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportKind,
} from "@/lib/content-report";

/**
 * "Report this" under anything the model wrote.
 *
 * Quiet until opened — it sits under every evaluation, and a loud control
 * there would read as the product expecting to be wrong. Opened, it asks the
 * one question that sorts the queue (what kind of wrong) and leaves room to
 * say more.
 */
export function ReportContent({
  kind,
  targetId,
}: {
  kind: ReportKind;
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(reportContentAction, undefined);

  if (state && "ok" in state) {
    return (
      <p className="text-xs text-zinc-500">
        Reported — thank you. Someone will read it.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-500 underline underline-offset-2 hover:text-foreground"
      >
        Report this AI-generated content
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="max-w-md space-y-3 rounded-lg border border-black/10 p-4 text-sm dark:border-white/15"
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="targetId" value={targetId} />
      <fieldset className="space-y-1.5">
        <legend className="mb-1 font-medium">What was wrong with it?</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="radio" name="reason" value={r} required />
            {REPORT_REASON_LABELS[r]}
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="text-zinc-600 dark:text-zinc-400">
          Anything else? (optional)
        </span>
        <textarea
          name="details"
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-2 py-1.5 dark:border-white/20"
        />
      </label>
      {state && "error" in state && (
        <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {pending ? "Sending…" : "Send report"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-black/15 px-3 py-1.5 dark:border-white/20"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
