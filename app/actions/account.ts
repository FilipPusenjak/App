"use server";

import { revalidatePath } from "next/cache";
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

/**
 * Turn the multi-student view on or off for this account.
 *
 * Presentation only. It decides whether the Students tab is offered and grants
 * nothing — every query in the app is scoped by the authenticated user id
 * either way, so this cannot widen what anyone can reach.
 *
 * Note what it CANNOT do: switching it off does not hide students that already
 * exist (see shouldShowStudents). A setting that could strand someone's own
 * profiles behind a hidden page would be a data-loss bug wearing a checkbox.
 */
export async function setManagesStudentsAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { managesStudents: formData.get("managesStudents") === "on" },
  });
  revalidatePath("/", "layout");
}
