"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * The two things a student can run.
 *
 * There used to be three, because "Deep Review" named a separate band-based
 * tier sitting above the percentile evaluation, behind a plan gate and a 21-day
 * floor. That tier is retired: the percentile evaluation IS the Deep Review
 * now, and there is no gate in front of it. What is left is the full review and
 * the fortnightly check-in that follows up on it.
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
  const router = useRouter();
  const [running, setRunning] = useState<"review" | "checkin" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Whether the refusal was about the PLAN, which is the one a link can fix.
  // A 429 or a 502 has nothing useful on the billing page, and sending somebody
  // there to solve a rate limit would waste the one action we offered them.
  const [offerUpgrade, setOfferUpgrade] = useState(false);

  async function post(url: string, body: unknown, kind: "review" | "checkin") {
    setRunning(kind);
    setFailure(null);
    setOfferUpgrade(false);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        id?: string;
        error?: string;
        reason?: string;
      };
      if (!res.ok) {
        setFailure(data.error ?? "The review could not be run.");
        // 402 is the quota refusal — either the plan does not include this run
        // at all, or the interval has not elapsed. Upgrading or entering a code
        // resolves both, and both live on the billing page.
        setOfferUpgrade(res.status === 402);
        // A failed run is still recorded, so refresh the list to show it.
        router.refresh();
        return;
      }
      if (data.id) router.push(`/evaluations/${data.id}`);
    } catch {
      setFailure("Could not reach the server. Is the app still running?");
    } finally {
      setRunning(null);
    }
  }

  const runReview = () => post("/api/evaluate", { full: false }, "review");
  const runCheckIn = () => post("/api/evaluations/check-in", {}, "checkin");

  return (
    // Full width on a phone, where a primary action floating at the right edge
    // reads as an afterthought and is a reach for a thumb. Right-aligned from
    // tablet up, where it sits beside the heading as before.
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <button
        type="button"
        onClick={runReview}
        disabled={running !== null || disabled}
        title={disabled ? disabledReason : undefined}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 sm:py-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {running === "review"
          ? "Reviewing… (this can take a minute)"
          : canFollowUp
            ? "Run a new Deep Review"
            : "Run a Deep Review"}
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
          disabled={running !== null}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-black/15 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-50 sm:py-2 dark:border-white/20 dark:hover:bg-white/10"
        >
          {running === "checkin" ? "Checking in…" : "Run a Check-In"}
        </button>
      )}

      {disabled && disabledReason && (
        <p className="text-xs text-zinc-500 sm:text-right">{disabledReason}</p>
      )}

      {failure && (
        <div className="sm:max-w-md sm:text-right">
          <p className="text-xs text-red-600 dark:text-red-400">{failure}</p>
          {/* The message names Settings → Plan; this makes it one tap instead
              of a navigation instruction. Shown only for the refusal it can
              actually resolve. */}
          {offerUpgrade && (
            <Link
              href="/settings/billing"
              className="mt-2 inline-flex items-center justify-center rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Upgrade or enter a code
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
