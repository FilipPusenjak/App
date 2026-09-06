"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  requestPasswordResetAction,
  type ForgotPasswordState,
} from "@/app/actions/password-reset";
import { fieldClass } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";

/**
 * Ask for a reset link.
 *
 * Rendered only on a deployment that can actually send mail — see the page,
 * which keeps the old "ask the operator" instructions otherwise. A form that
 * accepts an address and silently sends nothing is worse than no form: it
 * leaves somebody refreshing an inbox instead of asking a person who could
 * have helped them in a minute.
 *
 * The confirmation is a NOTICE, not an error, and it stays on screen with the
 * form still available — the most likely next thing after "check your inbox"
 * is realising you typed the wrong address.
 */
export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(
    requestPasswordResetAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      {state?.notice && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {state.notice}
        </p>
      )}

      <div>
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state?.email}
          className={fieldClass}
        />
        {state?.fieldErrors?.email && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white outline-none transition-colors hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-700/40 focus-visible:ring-offset-2 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus-visible:ring-zinc-300/40"
      >
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Sending…
          </span>
        ) : (
          "Email me a reset link"
        )}
      </button>

      <p className="text-center text-sm text-zinc-500">
        <Link
          href="/login"
          className="font-medium text-zinc-900 underline dark:text-zinc-100"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
