"use server";

import { signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { closeBillingForUser } from "@/lib/billing/close-account";

export type DeleteAccountState = { error?: string } | undefined;

/**
 * Permanently delete the signed-in account and everything attached to it.
 *
 * Deleting the User is enough for the DATABASE: Profile cascades from User, and
 * resume items, test scores, target schools, evaluations, caseload links and
 * subscriptions all cascade from there. There is no soft-delete and no
 * recovery — for an app holding a minor's personal data, "deleted" should mean
 * gone.
 *
 * BILLING IS CLOSED FIRST, AND THE DELETE IS ABANDONED IF THAT FAILS. Cascading
 * the Subscription row away does not tell Stripe anything: the subscription
 * would stay active and the card would keep being charged every month, for an
 * account that no longer exists and cannot be logged into to stop it. So Stripe
 * is told first, and a failure there aborts the whole thing with the account
 * intact — being unable to delete is a recoverable problem, being charged
 * forever is not.
 *
 * The user must retype their own email address. That is not security (they are
 * already authenticated); it is a guard against destroying everything with a
 * misclick.
 */
export async function deleteAccountAction(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const user = await getCurrentUser();
  if (!user?.id || !user.email) {
    return { error: "You are not signed in." };
  }

  const typed = String(formData.get("confirmEmail") ?? "")
    .trim()
    .toLowerCase();

  if (typed !== user.email.toLowerCase()) {
    return {
      error: "That doesn't match your email address. Nothing has been deleted.",
    };
  }

  // Stripe first. If this fails the account survives and they can try again;
  // if it were second, a failure would leave a deleted account being billed.
  const billing = await closeBillingForUser(user.id);
  if (!billing.ok) {
    return { error: billing.error ?? "Could not close billing. Nothing has been deleted." };
  }

  // Delete by the session's user id — never by anything the form supplied.
  await prisma.user.delete({ where: { id: user.id } });

  // Clear the session cookie; the account it referred to no longer exists.
  await signOut({ redirectTo: "/" });
  return undefined;
}
