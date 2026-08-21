"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Draft prep for ONE student, on demand.
 *
 * There is no caseload-wide equivalent anywhere in this product, and its
 * absence is a design decision rather than an omission. Prep is the only
 * per-student model cost here — triage calls nothing — so a "prepare everyone"
 * button would multiply the entire variable cost of the product by the size of
 * the caseload, to produce documents for students nobody is about to meet.
 */
export function GeneratePrepButton({
  linkId,
  hasPrep,
}: {
  linkId: string;
  hasPrep: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/counselor/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Prep could not be drafted.");
      }
      // Refresh either way: a failed attempt is recorded with what it cost and
      // should appear rather than vanish.
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        onClick={generate}
        disabled={running}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {running
          ? "Drafting…"
          : hasPrep
            ? "Draft fresh prep"
            : "Draft session prep"}
      </button>
      {error && (
        <p className="max-w-sm text-xs text-red-600 sm:text-right dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
