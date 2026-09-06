// Password reset tokens — the rules, with no database in sight.
//
// Split from the store (password-reset-store.ts) for the same reason stale.ts
// is split from stale-sweep.ts: these are the decisions worth testing directly,
// and they should not drag Prisma into anything that wants to check them.
//
// A reset token is a bearer credential. Anyone holding one can take over an
// account containing a minor's personal data without knowing the password, so
// every rule below resolves toward refusing:
//
//   - 256 bits of CSPRNG randomness, so guessing is not a strategy.
//   - Only the SHA-256 is ever persisted; the token exists in plaintext once,
//     in the link handed to the person resetting.
//   - Single use. Redeeming marks it spent, and spent is permanent.
//   - Short lived, because an old link in someone's message history is the
//     realistic way one of these leaks.
import { createHash, randomBytes } from "node:crypto";

/**
 * How long a link works for.
 *
 * An hour, not a day: the delivery path is a human forwarding a URL, and the
 * copy of it left behind in that conversation stays valid for exactly as long
 * as this number says.
 */
export const RESET_TOKEN_TTL_MINUTES = Number(
  process.env.PASSWORD_RESET_TTL_MINUTES ?? 60,
);

/**
 * How many reset links one account may be sent per hour.
 *
 * The forgot-password form is unauthenticated and sends mail to an address the
 * requester types, which is the shape of a tool for flooding somebody's inbox.
 * Three is enough for a person who mistypes their address, deletes the mail, or
 * waits for one that was slow — and low enough that the form is useless as a
 * way to bother anybody.
 *
 * Counted against ISSUED TOKENS rather than requests, so it throttles only the
 * addresses that actually have an account. A request for an address with no
 * account issues nothing, and so can never fill anyone's quota.
 */
export const RESET_REQUESTS_PER_HOUR = 3;

/**
 * The sentence shown after asking for a reset link.
 *
 * ALWAYS this one, whatever happened. A registered address, an address with no
 * account, and an address that has already had its three links this hour all
 * produce it, because a form that answers differently is a way for anyone to
 * find out who has an account here — and the people with accounts here are
 * mostly minors.
 *
 * Lives HERE rather than beside the action that returns it, because that file
 * carries "use server" and such a file may only export async functions. Next
 * rejects a string export from one at runtime, which is a 500 on submit rather
 * than a build error — caught by opening the page, not by any test.
 */
export const RESET_REQUESTED_MESSAGE =
  "If there's an account with that address, a reset link is on its way. " +
  "It works once and expires in an hour — check your spam folder if it " +
  "doesn't arrive.";

/** SHA-256, hex. The only form of a token that touches storage. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A new token and the hash to store against it.
 *
 * base64url so it survives being pasted into a URL, a chat message, and back
 * out again without escaping — the actual delivery path here.
 */
export function mintResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

export function resetTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
}

export type ResetTokenRecord = { expiresAt: Date; usedAt: Date | null };

/**
 * Why a token is not usable, or "valid".
 *
 * `unknown` covers both "no such token" and a malformed one, deliberately: the
 * two are indistinguishable to whoever is holding the link, and separating
 * them in a message would only tell an attacker which guesses were closer.
 */
export type ResetTokenState = "valid" | "expired" | "used" | "unknown";

export function resetTokenState(
  record: ResetTokenRecord | null | undefined,
  now: Date = new Date(),
): ResetTokenState {
  if (!record) return "unknown";
  // Used before expired: a spent token that has also aged out is spent, and
  // saying "expired" would imply a fresh one behaves differently.
  if (record.usedAt != null) return "used";
  if (record.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

/**
 * What to show someone whose link did not work.
 *
 * Every failure ends at the same place — ask for another link — because none
 * of them is recoverable by the person reading it, and a message that varies
 * by reason is a probe an attacker can run.
 */
export function resetTokenMessage(state: ResetTokenState): string | null {
  if (state === "valid") return null;
  if (state === "expired") {
    return `That link has expired — they last ${RESET_TOKEN_TTL_MINUTES} minutes. Ask for a new one.`;
  }
  if (state === "used") {
    return "That link has already been used. Ask for a new one if you still need to change your password.";
  }
  return "That link isn't valid. Ask for a new one.";
}
