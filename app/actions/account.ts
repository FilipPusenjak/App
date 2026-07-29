"use server";

import { signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export type DeleteAccountState = { error?: string } | undefined;

/**
 * Permanently delete the signed-in account and everything attached to it.
 *
 * Deleting the User is enough: Profile cascades from User, and resume items,
 * test scores, target schools, and evaluations all cascade from Profile. There
 * is no soft-delete and no recovery — for an app holding a minor's personal
 * data, "deleted" should mean gone.
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

  // Delete by the session's user id — never by anything the form supplied.
  await prisma.user.delete({ where: { id: user.id } });

  // Clear the session cookie; the account it referred to no longer exists.
  await signOut({ redirectTo: "/" });
  return undefined;
}
