"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Failure = {
  message: string;
  /** "tier" and "interval" are refusals with a reason, not errors. */
  reason?: "tier" | "interval";
};

export function RunEvaluationButton({
  disabled,
  disabledReason,
  /** True once a real evaluation exists, so a re-run would be a follow-up. */
  canFollowUp = false,
  /** Resolved on the server — see the comment where it is computed. */
  deepReviewAllowed = false,
  deepReviewBlockedReason,
}: {
  disabled?: boolean;
  disabledReason?: string;
  canFollowUp?: boolean;
  deepReviewAllowed?: boolean;
  deepReviewBlockedReason?: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState<"deep" | "scored" | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function post(url: string, body: unknown, kind: "deep" | "scored") {
    setRunning(kind);
    setFailure(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        id?: string;
        error?: string;
        reason?: "tier" | "interval";
      };
      if (!res.ok) {
        setFailure({
          message: data.error ?? "The evaluation could not be run.",
          reason: data.reason,
        });
        // A failed run is still recorded, so refresh the list to show it.
        router.refresh();
        return;
      }
      if (data.id) router.push(`/evaluations/${data.id}`);
    } catch {
      setFailure({
        message: "Could not reach the server. Is the app still running?",
      });
    } finally {
      setRunning(null);
    }
  }

  const runDeep = () => post("/api/evaluations/deep-review", {}, "deep");
  const runScored = () => post("/api/evaluate", { full: false }, "scored");

  return (
    // Full width on a phone, where a primary action floating at the right edge
    // reads as an afterthought and is a reach for a thumb. Right-aligned from
    // tablet up, where it sits beside the heading as before.
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      {/* The primary action is whichever one this student can actually run.
          Offering a Deep Review button to someone the server will refuse turns
          a plan boundary into a broken feature, and the 21-day floor into an
          error message. */}
      <button
        type="button"
        onClick={deepReviewAllowed ? runDeep : runScored}
        disabled={running !== null || disabled}
        title={disabled ? disabledReason : undefined}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 sm:py-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {running === "deep"
          ? "Reviewing… (this can take a couple of minutes)"
          : running === "scored"
            ? "Evaluating… (this can take a minute)"
            : deepReviewAllowed
              ? "Run a Deep Review"
              : "Run evaluation"}
      </button>

      {/* The older percentile evaluation, kept reachable underneath a Deep
          Review. It is not the primary read any more, but it is not dead
          either: it is the only thing that produces the 0-100 scores the trend
          chart and the projection baseline are expressed in, and a student
          part-way through a run of them is owed one more point on their own
          graph rather than a series that ends mid-sentence. */}
      {deepReviewAllowed && canFollowUp && !disabled && (
        <button
          type="button"
          onClick={runScored}
          disabled={running !== null}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 disabled:opacity-50 sm:text-right dark:hover:text-zinc-100"
        >
          Run a scored evaluation instead (the older 0–100 read)
        </button>
      )}

      {/* Why the Deep Review isn't on offer. Shown as ordinary text, because a
          21-day gap that exists on purpose is not a fault to apologise for. */}
      {!deepReviewAllowed && deepReviewBlockedReason && !disabled && (
        <p className="text-xs text-zinc-500 sm:max-w-md sm:text-right">
          {deepReviewBlockedReason}
        </p>
      )}

      {disabled && disabledReason && (
        <p className="text-xs text-zinc-500 sm:text-right">{disabledReason}</p>
      )}

      {/* A refusal with a reason is not an error, and colouring it red would
          teach a student that being told "not yet, and here is why" is a
          malfunction. Only genuine failures are red. */}
      {failure && (
        <p
          className={`text-xs sm:max-w-md sm:text-right ${
            failure.reason
              ? "text-zinc-600 dark:text-zinc-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {failure.message}
        </p>
      )}
    </div>
  );
}
