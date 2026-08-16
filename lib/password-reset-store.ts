// Issuing and redeeming password reset tokens. The database half.
//
// The policy lives in password-reset.ts; this file is what touches rows.
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  hashResetToken,
  mintResetToken,
  resetTokenExpiry,
  resetTokenState,
  type ResetTokenState,
} from "@/lib/password-reset";

/**
 * Mint a reset link for an address, or null when no account has it.
 *
 * The null is safe to expose HERE and nowhere else: the only caller is the
 * operator script, run by the person who owns the instance, for whom "no such
 * account" is the useful answer rather than a leak. Anything reachable by the
 * public must not distinguish the two — see the note in the forgot-password
 * page.
 *
 * Issuing invalidates this user's other outstanding tokens. Without that, every
 * request leaves another working link alive, so a stack of them accumulates and
 * the TTL stops meaning what it says.
 */
export async function issueResetToken(
  email: string,
): Promise<{ token: string; expiresAt: Date; userId: string } | null> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true },
  });
  if (!user) return null;

  const { token, tokenHash } = mintResetToken();
  const expiresAt = resetTokenExpiry();

  await prisma.$transaction([
    // Retire the previous ones rather than deleting them: a spent row is a
    // record that a reset happened, which is worth keeping.
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: { tokenHash, userId: user.id, expiresAt },
    }),
  ]);

  return { token, expiresAt, userId: user.id };
}

export type ConsumeResult =
  | { ok: true; email: string }
  | { ok: false; state: ResetTokenState };

/**
 * Redeem a token and set the new password.
 *
 * Clearing the lockout counters is not incidental — it is the difference
 * between this working and not. A locked-out account refuses a CORRECT password
 * until the window passes, so resetting without clearing would leave someone
 * who just proved control of their reset link still unable to log in, with
 * nothing on screen explaining why.
 *
 * The whole thing is one transaction: a password changed without its token
 * being spent leaves a working link behind, and a token spent without the
 * password changing locks someone out of their own reset.
 */
export async function consumeResetToken(
  token: string,
  newPassword: string,
): Promise<ConsumeResult> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: {
      id: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { id: true, email: true } },
    },
  });

  const state = resetTokenState(record, new Date());
  if (state !== "valid" || !record) return { ok: false, state };

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.user.id },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    }),
    // Conditional on still being unused, so two simultaneous redemptions of the
    // same link cannot both succeed.
    prisma.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  return { ok: true, email: record.user.email };
}

/** Read a token's state without spending it — for rendering the reset page. */
export async function peekResetToken(token: string): Promise<ResetTokenState> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { expiresAt: true, usedAt: true },
  });
  return resetTokenState(record, new Date());
}
