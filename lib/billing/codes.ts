// Access codes: minting them, and redeeming them.
//
// These exist to hand somebody a single run during testing, without giving them
// a plan, a card, or a discount. A code grants a RUN, never a price — so it
// touches no billing path and is worth nothing to a stranger who finds one
// beyond a single Deep Review, bounded by maxRedemptions and by the account
// spend cap sitting underneath everything.
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { RUN_KINDS, type RunKind } from "./quota";

/**
 * The alphabet codes are drawn from.
 *
 * No 0/O, no 1/I/L, no 5/S, no 8/B. These get read down a phone and typed by
 * somebody who did not write them, and every one of those pairs is a support
 * message waiting to happen. Uppercase only, for the same reason.
 */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY2346789";

/** Groups of four, hyphenated: CHART-4KQF-7NDX. Long enough not to be guessed. */
export function generateCode(): string {
  const groups = [4, 4, 4].map(() =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
  );
  return ["CHART", ...groups.slice(0, 2)].join("-");
}

/**
 * Normalize what somebody typed.
 *
 * Case, spaces and missing hyphens are all things a person does when copying a
 * code off a screen, and none of them should be a failed redemption.
 */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The stored form, compared against the same normalization. */
export function storedForm(code: string): string {
  return normalizeCode(code);
}

export type RedeemResult =
  | { ok: true; kind: RunKind; granted: number; totalRemaining: number }
  | {
      ok: false;
      reason:
        | "not-found"
        | "expired"
        | "exhausted"
        | "already-redeemed";
      message: string;
    };

/**
 * Redeem a code for an account.
 *
 * Everything happens in ONE transaction, and the redemption row's unique
 * constraint is what enforces "once per account" — checking first and writing
 * after would let two simultaneous requests both pass the check. The same
 * transaction increments the code's counter and the account's credit, so a
 * failure anywhere leaves none of it applied.
 */
export async function redeemCode(input: {
  userId: string;
  code: string;
  now?: Date;
}): Promise<RedeemResult> {
  const now = input.now ?? new Date();
  const normalized = normalizeCode(input.code);

  if (!normalized) {
    return { ok: false, reason: "not-found", message: "Enter a code." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const code = await tx.accessCode.findUnique({
        where: { code: normalized },
      });

      // Deliberately the same message for "no such code" as for a malformed
      // one: a probe should not learn which codes exist.
      if (!code) {
        return {
          ok: false as const,
          reason: "not-found" as const,
          message: "That code is not valid.",
        };
      }

      // THIS account's own prior use, checked BEFORE exhaustion. A single-use
      // code redeemed twice by the same person is otherwise reported as "used
      // the maximum number of times", which reads as somebody else having taken
      // it — alarming, and wrong. The unique constraint below still handles the
      // race; this is about telling the truth in the common case.
      const mine = await tx.accessCodeRedemption.findUnique({
        where: {
          accessCodeId_userId: { accessCodeId: code.id, userId: input.userId },
        },
        select: { id: true },
      });
      if (mine) {
        return {
          ok: false as const,
          reason: "already-redeemed" as const,
          message: "You have already used that code.",
        };
      }

      if (code.expiresAt && code.expiresAt <= now) {
        return {
          ok: false as const,
          reason: "expired" as const,
          message: "That code has expired.",
        };
      }

      if (code.redemptionCount >= code.maxRedemptions) {
        return {
          ok: false as const,
          reason: "exhausted" as const,
          message: "That code has already been used the maximum number of times.",
        };
      }

      // The unique constraint on [accessCodeId, userId] does the real work. A
      // duplicate throws P2002 and is caught below.
      await tx.accessCodeRedemption.create({
        data: { accessCodeId: code.id, userId: input.userId },
      });

      await tx.accessCode.update({
        where: { id: code.id },
        data: { redemptionCount: { increment: 1 } },
      });

      const kind = code.grantsKind as RunKind;
      const credit = await tx.runCredit.upsert({
        where: { userId_kind: { userId: input.userId, kind } },
        create: { userId: input.userId, kind, remaining: code.grantsCount },
        update: { remaining: { increment: code.grantsCount } },
      });

      return {
        ok: true as const,
        kind,
        granted: code.grantsCount,
        totalRemaining: credit.remaining,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        reason: "already-redeemed",
        message: "You have already used that code.",
      };
    }
    throw error;
  }
}

/**
 * Spend one credit, if one is there.
 *
 * Returns whether it was spent. The conditional update — `remaining: { gt: 0 }`
 * in the WHERE — is what makes this safe under concurrency: two simultaneous
 * runs cannot both decrement the same last credit, because the second matches
 * no row.
 */
export async function consumeCredit(
  userId: string,
  kind: RunKind,
): Promise<boolean> {
  const result = await prisma.runCredit.updateMany({
    where: { userId, kind, remaining: { gt: 0 } },
    data: { remaining: { decrement: 1 } },
  });
  return result.count > 0;
}

/** Credits this account holds, by kind. Absent kinds are zero. */
export async function creditsFor(
  userId: string,
): Promise<Record<RunKind, number>> {
  const rows = await prisma.runCredit.findMany({
    where: { userId },
    select: { kind: true, remaining: true },
  });

  const out = Object.fromEntries(RUN_KINDS.map((k) => [k, 0])) as Record<
    RunKind,
    number
  >;
  for (const row of rows) {
    if ((RUN_KINDS as readonly string[]).includes(row.kind)) {
      out[row.kind as RunKind] = row.remaining;
    }
  }
  return out;
}

/** Mint a code. Used by scripts/make-access-code.ts, not by any route. */
export async function createAccessCode(input: {
  kind: RunKind;
  grantsCount?: number;
  maxRedemptions?: number;
  expiresAt?: Date | null;
  note?: string | null;
}): Promise<{ code: string; id: string }> {
  // Retry on the astronomically unlikely collision rather than failing.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const existing = await prisma.accessCode.findUnique({
      where: { code: storedForm(code) },
      select: { id: true },
    });
    if (existing) continue;

    const created = await prisma.accessCode.create({
      data: {
        code: storedForm(code),
        grantsKind: input.kind,
        grantsCount: input.grantsCount ?? 1,
        maxRedemptions: input.maxRedemptions ?? 1,
        expiresAt: input.expiresAt ?? null,
        note: input.note ?? null,
      },
      select: { id: true },
    });
    return { code, id: created.id };
  }
  throw new Error("Could not generate an unused code after several attempts.");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
