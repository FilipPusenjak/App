"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunEvaluationButton({
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
      const res = await fetch("/api/evaluate", { method: "POST" });
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
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={run}
        disabled={running || disabled}
        title={disabled ? disabledReason : undefined}
        className="inline-flex items-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {running ? "Evaluating… (this can take a minute)" : "Run evaluation"}
      </button>
      {disabled && disabledReason && (
        <p className="text-xs text-zinc-500">{disabledReason}</p>
      )}
      {error && (
        <p className="max-w-md text-right text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
