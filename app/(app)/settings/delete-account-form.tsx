"use client";

import { useActionState, useState } from "react";
import {
  deleteAccountAction,
  type DeleteAccountState,
} from "@/app/actions/account";
import { Input, FormError } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";

export function DeleteAccountForm({
  email,
  storeSubscription = null,
}: {
  email: string;
  /**
   * Set when a live subscription was bought in the App Store or Google Play.
   * Deleting the account cancels Stripe for you, but nothing can cancel a
   * store subscription except its owner, in the store — so they are told,
   * before they lose the account they would check it from.
   */
  storeSubscription?: "APPLE" | "GOOGLE" | null;
}) {
  const [state, action] = useActionState<DeleteAccountState, FormData>(
    deleteAccountAction,
    undefined,
  );
  // The form stays collapsed until asked for, so the destructive control isn't
  // sitting one stray click away.
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
      >
        Delete my account…
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3" noValidate>
      <FormError message={state?.error} />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This deletes your account, your profile, every resume item, test score
        and target school, and every saved evaluation. It cannot be undone and
        there is no backup — download your data first if you want to keep it.
      </p>
      {storeSubscription && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-semibold">Cancel your Plus subscription first.</strong>{" "}
          You bought it in {storeSubscription === "APPLE" ? "the App Store" : "Google Play"},
          and deleting your account does not stop{" "}
          {storeSubscription === "APPLE" ? "Apple" : "Google"} from charging you. Cancel it
          in your {storeSubscription === "APPLE" ? "App Store" : "Google Play"} subscription
          settings.
        </p>
      )}
      <div>
        <label htmlFor="confirmEmail" className="text-sm font-medium">
          Type <span className="font-mono">{email}</span> to confirm
        </label>
        <Input
          id="confirmEmail"
          name="confirmEmail"
          autoComplete="off"
          placeholder={email}
        />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton variant="danger" pendingText="Deleting…">
          Permanently delete everything
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
