"use client";

import { useTransition } from "react";
import { setAiConsentAction } from "@/app/actions/ai-consent";

/**
 * Withdrawing takes one click, the same as allowing did — a permission that is
 * easy to give and hard to take back is not much of one.
 */
export function AiConsentToggle({ allowed }: { allowed: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setAiConsentAction(!allowed);
        })
      }
      className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
    >
      {pending ? "Saving…" : allowed ? "Turn off AI features" : "Allow AI features"}
    </button>
  );
}
