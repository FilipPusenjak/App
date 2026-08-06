"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunEvaluationButton({
  disabled,
  disabledReason,
  /** True once a real evaluation exists, so a re-run would be a follow-up. */
  canFollowUp = false,
}: {
  disabled?: boolean;
  disabledReason?: string;
  canFollowUp?: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState<"normal" | "full" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(full = false) {
    setRunning(full ? "full" : "normal");
    setError(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Evaluation failed.");
        // A failed run is still recorded, so refresh the list to show it.
        router.refresh();
        return;
      }
      if (data.id) router.push(`/evaluations/${data.id}`);
    } catch {
      setError("Could not reach the server. Is the app still running?");
    } finally {
      setRunning(null);
    }
  }

  return (
    // Full width on a phone, where a primary action floating at the right edge
    // reads as an afterthought and is a reach for a thumb. Right-aligned from
    // tablet up, where it sits beside the heading as before.
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <button
        type="button"
        onClick={() => run(false)}
        disabled={running !== null || disabled}
        title={disabled ? disabledReason : undefined}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 sm:py-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {running === "normal"
          ? "Evaluating… (this can take a minute)"
          : "Run evaluation"}
      </button>

      {/* The way back to a full-strength read.
          Once a baseline exists, an ordinary run is a follow-up: anchored to
          your previous scores and judged by a cheaper model. That is the right
          default and it is most of the saving. But a student who thinks the
          numbers have gone stale needs a way to ask for the strong model again
          without deleting their history to get it. */}
      {canFollowUp && !disabled && (
        <button
          type="button"
          onClick={() => run(true)}
          disabled={running !== null}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50 sm:text-right dark:hover:text-zinc-100"
        >
          {running === "full"
            ? "Running a full evaluation…"
            : "Run a full evaluation instead (slower, costs more)"}
        </button>
      )}
      {disabled && disabledReason && (
        <p className="text-xs text-zinc-500 sm:text-right">{disabledReason}</p>
      )}
      {error && (
        <p className="text-xs text-red-600 sm:max-w-md sm:text-right dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
