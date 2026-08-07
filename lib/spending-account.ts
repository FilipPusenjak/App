// Reading what an account has spent.
//
// The rule itself lives in spending.ts, free of database and session imports so
// it can be tested directly. This is the part that reaches for data, and it is
// ownership-scoped like everything else here.
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { estimateCost } from "@/lib/cost";
import { evaluateSpend, getSpendLimitUsd, type SpendStatus } from "./spending";

/**
 * What this account has spent, across every student it holds.
 *
 * Ownership-scoped like every other query here: filtered by the authenticated
 * user id, never by anything a client supplied.
 *
 * Sample runs are excluded — they never called the API and cost nothing.
 * FAILED runs are included, because they burned tokens before failing; leaving
 * them out would let a loop of failing runs spend without limit.
 */
export async function getAccountSpendUsd(): Promise<number> {
  const userId = await requireUserId();
  const where = { profile: { userId }, isSample: false } as const;
  const select = {
    model: true,
    inputTokens: true,
    outputTokens: true,
    cacheWriteTokens: true,
    cacheReadTokens: true,
  } as const;

  const [evaluations, projections] = await Promise.all([
    prisma.evaluation.findMany({ where, select }),
    prisma.projection.findMany({ where, select }),
  ]);

  let total = 0;
  for (const row of [...evaluations, ...projections]) {
    total += estimateCost(row, row.model) ?? 0;
  }
  return total;
}

/** The account's spend measured against its cap. */
export async function getSpendStatus(): Promise<SpendStatus> {
  return evaluateSpend(await getAccountSpendUsd(), getSpendLimitUsd());
}
