// Brute-force protection for password login.
//
// Without this, an attacker can try passwords against a known address as fast
// as the server will answer. bcrypt at cost 12 slows each attempt to roughly a
// quarter-second, which raises the cost but does not stop a determined or
// distributed attempt — and this app sits in front of a minor's personal data.
//
// State lives on the User row rather than in process memory, for the same
// reason the evaluation limiter is database-backed: a serverless instance
// starts with an empty map and would enforce nothing.
//
// Trade-off worth knowing: a lockout is a denial-of-service against that one
// account, since anyone who knows the address can trip it. The window is
// deliberately short so it degrades to an inconvenience rather than a lockout,
// and a correct password is still refused while it lasts.
import { prisma } from "@/lib/db";

export const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS ?? 10);
export const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES ?? 15);

export function isLockedOut(user: {
  lockedUntil: Date | null;
}): boolean {
  return user.lockedUntil != null && user.lockedUntil.getTime() > Date.now();
}

/** Count a failed attempt, locking the account once the threshold is crossed. */
export async function recordFailedLogin(user: {
  id: string;
  failedLoginAttempts: number;
}): Promise<void> {
  const attempts = user.failedLoginAttempts + 1;
  const shouldLock = attempts >= MAX_FAILED_LOGINS;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: shouldLock ? 0 : attempts,
      lockedUntil: shouldLock
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null,
    },
  });
}

/** Clear the counter after a successful login. */
export async function clearFailedLogins(user: {
  id: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}): Promise<void> {
  if (user.failedLoginAttempts === 0 && user.lockedUntil == null) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
