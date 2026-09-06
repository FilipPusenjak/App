"use client";

import { Spinner } from "@/components/ui/spinner";
import { useRunProgress } from "../run-progress";

/**
 * The two things a student can run.
 *
 * There used to be three, because "Deep Review" named a separate band-based
 * tier sitting above the percentile evaluation, behind a plan gate and a 21-day
 * floor. That tier is retired: the percentile evaluation IS the Deep Review
 * now, and there is no gate in front of it. What is left is the full review and
 * the fortnightly check-in that follows up on it.
 *
 * The run itself is NOT owned here — see app/(app)/run-progress.tsx. This
 * component held it until a student pointed out that leaving the page made all
 * evidence of the running review disappear. What stays here is the button: the
 * label, the gate, and the local spinner for somebody who has not navigated
 * away.
 */
export function RunEvaluationButton({
  disabled,
  disabledReason,
  /** True once a real evaluation exists, so a check-in has something to read. */
  canFollowUp = false,
}: {
  disabled?: boolean;
  disabledReason?: string;
  canFollowUp?: boolean;
}) {
  const { run, busy, failure, start } = useRunProgress();

  const runReview = () =>
    start({ kind: "DEEP_REVIEW", url: "/api/evaluate", body: { full: false } });
  const runCheckIn = () =>
    start({ kind: "CHECK_IN", url: "/api/evaluations/check-in" });

  return (
    // Full width on a phone, where a primary action floating at the right edge
    // reads as an afterthought and is a reach for a thumb. Right-aligned from
    // tablet up, where it sits beside the heading as before.
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <button
        type="button"
        onClick={runReview}
        // `busy` is app-wide, not this button's own state. A student who
        // started a review, wandered off and came back would otherwise find an
        // enabled button and press it again — a second minute-long call, and a
        // second credit, for the run already in progress.
        disabled={busy || disabled}
        title={disabled ? disabledReason : undefined}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 sm:py-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {run?.kind === "DEEP_REVIEW" ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Reviewing… (this can take a minute)
          </span>
        ) : canFollowUp ? (
          "Run a new Deep Review"
        ) : (
          "Run a Deep Review"
        )}
      </button>

      {/* The fortnightly rhythm. Offered only once a real review exists,
          because a check-in with no baseline has nothing to compare against —
          it would still call the model and charge for a narrative about a
          fortnight nobody measured.

          Often this costs NOTHING: the route runs a deterministic pass first
          and, when nothing material has moved, records the check-in without
          calling a model at all. That is the expected outcome of a quiet
          fortnight rather than a failure. */}
      {canFollowUp && !disabled && (
        <button
          type="button"
          onClick={runCheckIn}
          disabled={busy}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-black/15 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-50 sm:py-2 dark:border-white/20 dark:hover:bg-white/10"
        >
          {run?.kind === "CHECK_IN" ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Checking in…
            </span>
          ) : (
            "Run a Check-In"
          )}
        </button>
      )}

      {disabled && disabledReason && (
        <p className="text-xs text-zinc-500 sm:text-right">{disabledReason}</p>
      )}

      {/* The banner in the layout carries the failure everywhere; this repeats
          it beside the button that caused it, which is where somebody who
          never left the page is already looking. */}
      {failure && (
        <p className="text-xs text-red-600 sm:max-w-md sm:text-right dark:text-red-400">
          {failure.message}
        </p>
      )}
    </div>
  );
}
