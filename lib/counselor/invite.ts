// The invitation, and which way round it runs.
//
// A counselor cannot type a student's email address to invite them. That design
// is the obvious one and it is wrong twice over: it turns the app into an oracle
// for whether an address belongs to a minor's account — try one, read the error
// message — and in an account holding three siblings it cannot say which student
// is meant, which is an ambiguous access grant, which is a leak with a delay on
// it.
//
// So the STUDENT issues a code and hands it over. Both problems disappear:
// nothing is disclosed to an address that never asked, and the student named the
// profile by choosing where to generate it.
//
// Redeeming a code IS the student's consent, recorded as such. A guardian still
// has to agree separately, from the student's own settings, before the counselor
// can read anything at all.
import { randomInt } from "node:crypto";

/**
 * The alphabet, minus everything that gets misread aloud.
 *
 * This code is spoken across a desk or typed off a phone screen, so 0/O, 1/I/L
 * and 5/S are absent. An unambiguous alphabet is worth more here than the two
 * extra bits it costs.
 */
const ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";
const CODE_LENGTH = 10;

/** How long an unredeemed code stays live. */
export const INVITE_TTL_DAYS = 14;

/**
 * A fresh invite code.
 *
 * 29^10 is about 4.2 × 10^14, drawn from a CSPRNG, and a code dies fourteen days
 * after it is made and the first time it is used. Guessing one is not a threat
 * model this needs to defend against beyond that.
 */
export function generateInviteCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * What a counselor typed, turned into what is stored.
 *
 * Case and spacing are forgiven because the code arrives by whatever route a
 * human chose — read aloud, pasted with a trailing space, typed with the hyphens
 * someone added to make it readable. Rejecting a correct code over a space would
 * be the app's fault presented as the user's.
 */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function isWellFormedInviteCode(raw: string): boolean {
  const code = normalizeInviteCode(raw);
  return (
    code.length === CODE_LENGTH &&
    [...code].every((c) => ALPHABET.includes(c))
  );
}

export function inviteExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
}

/** Grouped for reading aloud. Display only — never stored in this shape. */
export function formatInviteCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
