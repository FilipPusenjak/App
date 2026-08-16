"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/app/actions/password-reset";
import type { AuthFormState } from "@/app/actions/auth";

const fieldClass =
  "mt-1 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-white/20 dark:bg-black/20 dark:focus:ring-white/10";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    resetPasswordAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      {/* Carried in the form rather than re-read from the URL on submit, so the
          token validated is the one this page was rendered for. */}
      <input type="hidden" name="token" value={token} />

      {state?.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="password" className="text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          className={fieldClass}
        />
        {state?.fieldErrors?.password && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="text-sm font-medium">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          className={fieldClass}
        />
        {state?.fieldErrors?.confirmPassword && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {state.fieldErrors.confirmPassword}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
