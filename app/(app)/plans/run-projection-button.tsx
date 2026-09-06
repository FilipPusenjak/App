"use client";

import { Spinner } from "@/components/ui/spinner";
import { useRunProgress } from "../run-progress";

/**
 * As with the evaluation buttons, the run is owned by the layout's
 * RunProgressProvider rather than by this component — so walking away from
 * /plans no longer takes the only sign that a projection is running with it.
 */
export function RunProjectionButton({
  disabled,
  disabledReason,
}: {
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { run, busy, failure, start } = useRunProgress();

  return (
    // Full width on a phone, where a primary action floating mid-row reads as
    // an afterthought and is a reach for a thumb. Right-aligned from tablet up,
    // where it sits beside the heading as before.
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <button
        type="button"
        onClick={() => start({ kind: "PROJECTION", url: "/api/project" })}
        disabled={busy || disabled}
        title={disabled ? disabledReason : undefined}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 sm:py-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {run?.kind === "PROJECTION" ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Projecting…
          </span>
        ) : (
          "Project my plans"
        )}
      </button>
      {disabled && disabledReason && (
        <p className="text-xs text-zinc-500 sm:text-right">{disabledReason}</p>
      )}
      {failure && (
        <p className="text-xs text-red-600 sm:max-w-md sm:text-right dark:text-red-400">
          {failure.message}
        </p>
      )}
    </div>
  );
}
