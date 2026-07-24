"use client";

import { useFormStatus } from "react-dom";

// A submit button that disables itself and shows pending text while its
// enclosing <form> action is running. Works in any form (useActionState or plain).
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const { pending } = useFormStatus();

  const base =
    "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60";
  const variants = {
    primary:
      "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200",
    secondary:
      "border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10",
    danger:
      "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40",
  } as const;

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
