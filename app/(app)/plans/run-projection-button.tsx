"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunProjectionButton({
  disabled,
  disabledReason,
}: {
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/project", { method: "POST" });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Projection failed.");
        router.refresh();
        return;
      }
      if (data.id) router.push(`/projections/${data.id}`);
    } catch {
      setError("Could not reach the server. Is the app still running?");
    } finally {
      setRunning(false);
    }
  }

  return (
    // Full width on a phone, where a primary action floating mid-row reads as
    // an afterthought and is a reach for a thumb. Right-aligned from tablet up,
    // where it sits beside the heading as before.
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <button
        type="button"
        onClick={run}
        disabled={running || disabled}
        title={disabled ? disabledReason : undefined}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 sm:py-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {running ? "Projecting…" : "Project my plans"}
      </button>
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
