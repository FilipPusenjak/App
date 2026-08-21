"use server";

// The student's side of a counselor grant: consent, and taking it back.
//
// Every action here is scoped by the SESSION's user id in the WHERE clause, the
// same rule as every other action in this app. A link id arriving from a form is
// a claim to be checked, never an instruction to be followed.
//
// The asymmetry between the two directions is deliberate and is the whole point
// of the surface:
//
//   GRANTING is slow and requires two people. A counselor-initiated invite
//   creates a PENDING link that shows them nothing at all, and stays that way
//   until both the student and a guardian have said yes. There is no way from
//   here to grant access on someone else's behalf.
//
//   REVOKING is instant and unilateral. It needs no counselor approval, no
//   notice period, and no reason. A revocation that waits on the other party is
//   not a revocation, and one that demands a justification is a discouragement.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { requireOwnedProfile } from "@/lib/ownership";
import { revokeGrant } from "@/lib/counselor/access";
import {
  formatInviteCode,
  generateInviteCode,
  inviteExpiryFrom,
} from "@/lib/counselor/invite";

export type AccessResult = { ok?: boolean; message?: string; error?: string };

const idSchema = z.string().trim().min(1);

/**
 * Issue an invite code for one student, replacing any code already live.
 *
 * The student's half of the invitation. Scoped through requireOwnedProfile, so
 * a profile id from a form cannot mint a code for somebody else's student.
 *
 * Replacing rather than adding: one live code per student means a code handed
 * to the wrong person is cancelled by generating another, which is the action
 * someone in that situation would actually take.
 */
export async function createInviteCodeAction(
  _prev: AccessResult,
  fd: FormData,
): Promise<AccessResult> {
  const parsed = idSchema.safeParse(String(fd.get("profileId") ?? ""));
  if (!parsed.success) return { error: "Which student?" };

  const profile = await requireOwnedProfile(parsed.data);
  const code = generateInviteCode();
  await prisma.profile.update({
    where: { id: profile.id },
    data: {
      counselorInviteCode: code,
      counselorInviteExpiresAt: inviteExpiryFrom(new Date()),
    },
  });

  revalidatePath("/settings/access");
  return {
    ok: true,
    message: `Code ${formatInviteCode(code)} — give it only to the counselor you mean it for.`,
  };
}

/** Cancel a live code before anyone redeems it. */
export async function clearInviteCodeAction(
  _prev: AccessResult,
  fd: FormData,
): Promise<AccessResult> {
  const parsed = idSchema.safeParse(String(fd.get("profileId") ?? ""));
  if (!parsed.success) return { error: "Which student?" };

  const profile = await requireOwnedProfile(parsed.data);
  await prisma.profile.update({
    where: { id: profile.id },
    data: { counselorInviteCode: null, counselorInviteExpiresAt: null },
  });

  revalidatePath("/settings/access");
  return { ok: true, message: "Code cancelled. It can no longer be redeemed." };
}

/**
 * End a counselor's access, now.
 *
 * Note what is NOT deleted: the read log survives revocation. A student who
 * withdraws access is more likely to want the history of what was seen, not
 * less, and an audit log that disappears with the grant is an audit log that
 * vanishes exactly when it matters.
 */
export async function revokeGrantAction(
  _prev: AccessResult,
  fd: FormData,
): Promise<AccessResult> {
  const parsed = idSchema.safeParse(String(fd.get("linkId") ?? ""));
  if (!parsed.success) return { error: "Which grant?" };

  const done = await revokeGrant(parsed.data);
  if (!done) return { error: "That grant no longer exists." };

  revalidatePath("/settings/access");
  return { ok: true, message: "Access ended. They can no longer see anything." };
}

/**
 * Record the student's own consent on a pending link.
 *
 * Does not activate anything on its own. Both consents plus ACTIVE are required
 * by readableLinkWhere, and this writes exactly one of them — so a student
 * saying yes to an invite a guardian has not answered changes nothing about what
 * the counselor can see.
 */
export async function giveStudentConsentAction(
  _prev: AccessResult,
  fd: FormData,
): Promise<AccessResult> {
  const parsed = idSchema.safeParse(String(fd.get("linkId") ?? ""));
  if (!parsed.success) return { error: "Which invitation?" };

  const userId = await requireUserId();
  const link = await prisma.caseloadLink.findFirst({
    where: { id: parsed.data, studentUserId: userId, status: { not: "ENDED" } },
    select: { id: true, guardianConsentAt: true, studentConsentAt: true },
  });
  if (!link) return { error: "That invitation no longer exists." };
  if (link.studentConsentAt) return { ok: true, message: "Already agreed." };

  // The link becomes ACTIVE only when the second consent lands. Written in one
  // update so there is no window in which a link is ACTIVE with a consent
  // missing — a state readableLinkWhere would reject anyway, but which should
  // not be reachable in the first place.
  const bothNow = Boolean(link.guardianConsentAt);
  await prisma.caseloadLink.update({
    where: { id: link.id },
    data: {
      studentConsentAt: new Date(),
      ...(bothNow ? { status: "ACTIVE", startedAt: new Date() } : {}),
    },
  });

  revalidatePath("/settings/access");
  return {
    ok: true,
    message: bothNow
      ? "Access granted. You can end it at any time."
      : "Recorded. Nothing is shared until a parent or guardian also agrees.",
  };
}

/**
 * Record guardian consent, from the account that holds the student.
 *
 * In this app a guardian and a student may share one login — "a solo student is
 * just an account with one profile" — so this is an attestation made from the
 * owning account rather than a separate authenticated party. That is a real
 * limitation and it is stated on the page rather than hidden: the value of the
 * dual gate here is that it is a deliberate, separately-recorded act, not that
 * it is cryptographically distinct.
 */
export async function giveGuardianConsentAction(
  _prev: AccessResult,
  fd: FormData,
): Promise<AccessResult> {
  const parsed = idSchema.safeParse(String(fd.get("linkId") ?? ""));
  if (!parsed.success) return { error: "Which invitation?" };

  const userId = await requireUserId();
  const link = await prisma.caseloadLink.findFirst({
    where: { id: parsed.data, studentUserId: userId, status: { not: "ENDED" } },
    select: { id: true, guardianConsentAt: true, studentConsentAt: true },
  });
  if (!link) return { error: "That invitation no longer exists." };
  if (link.guardianConsentAt) return { ok: true, message: "Already agreed." };

  const bothNow = Boolean(link.studentConsentAt);
  await prisma.caseloadLink.update({
    where: { id: link.id },
    data: {
      guardianConsentAt: new Date(),
      ...(bothNow ? { status: "ACTIVE", startedAt: new Date() } : {}),
    },
  });

  revalidatePath("/settings/access");
  return {
    ok: true,
    message: bothNow
      ? "Access granted. You can end it at any time."
      : "Recorded. Nothing is shared until the student also agrees.",
  };
}
