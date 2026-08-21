"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type RecommendationRow = {
  id: string;
  text: string;
  status: string;
  declineReason: string | null;
};

/**
 * What the counselor decided about one drafted option.
 *
 * The two buttons are not symmetric in what they are for. "Passed this on"
 * records that advice left the building, which is what makes follow-through
 * measurable later. "Set aside" records a professional's refusal, and that is
 * the more valuable of the two: it is the one judgement in this product the
 * model never makes, and a run of them against the same kind of option is the
 * clearest evidence we have that the drafting is wrong.
 *
 * Neither button is a recommendation to press. There is deliberately no default,
 * no nudge, and no "you have undecided options" prompt anywhere — a counselor
 * who ignores every option and runs their own session has used this correctly.
 */
export function OptionDecision({
  recommendation,
}: {
  recommendation: RecommendationRow;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  async function set(status: string, declineReason?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/counselor/recommendations/${recommendation.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, declineReason }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save that.");
        return;
      }
      setDeclining(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (recommendation.status === "DELIVERED") {
    return <Decided label="Passed on" tone="delivered" />;
  }
  if (recommendation.status === "ACCEPTED_BY_STUDENT") {
    return <Decided label="Student accepted it" tone="accepted" />;
  }
  if (recommendation.status === "DECLINED_BY_COUNSELOR") {
    return (
      <Decided
        label="Set aside"
        tone="declined"
        note={recommendation.declineReason}
      />
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {declining ? (
        <div className="space-y-2">
          {/* Optional, and said so. A required reason produces a field full of
              "n/a", which is worse than an empty column. */}
          <label className="block text-xs text-zinc-500">
            Why not this one? Optional, and the most useful thing you can tell
            us — it is how the drafting gets better.
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-black/10 bg-white px-2 py-1.5 text-sm text-foreground dark:border-white/15 dark:bg-white/5"
            />
          </label>
          <div className="flex gap-2">
            <SmallButton
              onClick={() => set("DECLINED_BY_COUNSELOR", reason || undefined)}
              disabled={busy}
            >
              Set aside
            </SmallButton>
            <SmallButton onClick={() => setDeclining(false)} disabled={busy} subtle>
              Cancel
            </SmallButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => set("DELIVERED")} disabled={busy}>
            I passed this on
          </SmallButton>
          <SmallButton onClick={() => setDeclining(true)} disabled={busy} subtle>
            Set aside
          </SmallButton>
        </div>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function Decided({
  label,
  tone,
  note,
}: {
  label: string;
  tone: "delivered" | "accepted" | "declined";
  note?: string | null;
}) {
  const cls =
    tone === "accepted"
      ? "text-green-700 dark:text-green-300"
      : tone === "declined"
        ? "text-zinc-500"
        : "text-zinc-600 dark:text-zinc-400";
  return (
    <p className={`mt-2 text-xs ${cls}`}>
      {label}
      {note && <span className="text-zinc-500"> — {note}</span>}
    </p>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
  subtle,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        subtle
          ? "rounded-md border border-black/10 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:text-zinc-300 dark:hover:bg-white/10"
          : "rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      }
    >
      {children}
    </button>
  );
}
