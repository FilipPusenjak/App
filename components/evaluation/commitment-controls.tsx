"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Accept, decline, start or finish one commitment.
 *
 * The transitions offered here mirror the server's ALLOWED table rather than
 * inventing their own — the server is the authority and rejects anything else
 * with a 409, so a button that appears when the move is illegal would only
 * teach a student that the app is broken.
 *
 * A PROPOSED commitment can be declined straight out. That is deliberate and it
 * matters: a student saying "no, I'm not doing that" is a real answer, and
 * making them accept something first in order to drop it would put a
 * follow-through failure in their history where a considered decline belongs.
 */
export function CommitmentControls({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(next: string) {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch(`/api/commitments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "That didn't save.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const moves = MOVES[status] ?? [];
  if (moves.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {moves.map((m) => (
        <button
          key={m.to}
          type="button"
          onClick={() => move(m.to)}
          disabled={busy !== null || pending}
          className={
            m.primary
              ? "rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              : "rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
          }
        >
          {busy === m.to ? "Saving…" : m.label}
        </button>
      ))}
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}

/**
 * The moves offered at each status.
 *
 * "Set aside", not "abandon" or "give up". Dropping something deliberately is a
 * legitimate outcome and one of the more honest signals in the table — a later
 * deep review reads the pattern of what a student stops doing. Wording it as a
 * failure would push people to leave dead commitments open instead, which
 * destroys exactly the signal it is there to collect.
 */
const MOVES: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  PROPOSED: [
    { to: "ACCEPTED", label: "I'll do this", primary: true },
    { to: "ABANDONED", label: "Not this one" },
  ],
  ACCEPTED: [
    { to: "IN_PROGRESS", label: "Started" },
    { to: "COMPLETED", label: "Done" },
    { to: "ABANDONED", label: "Set aside" },
  ],
  IN_PROGRESS: [
    { to: "COMPLETED", label: "Done", primary: true },
    { to: "ABANDONED", label: "Set aside" },
  ],
  // COMPLETED and ABANDONED are terminal on the server too — no buttons.
};
