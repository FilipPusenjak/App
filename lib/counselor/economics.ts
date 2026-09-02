// What a caseload actually costs to run, per month.
//
// The counselor edition is priced per ACTIVE LINK per month, and that only
// works if the variable cost per link stays well under the price. Two things
// make that true, and both are structural rather than hoped for:
//
//   TRIAGE IS FREE. It calls no model at all, so monitoring forty students
//   costs a nightly Postgres pass and nothing else. Monitoring is the part a
//   counselor pays for continuously; if it had a per-student model cost, the
//   product's margin would scale inversely with how well it worked.
//
//   PREP IS BOUNDED AND ON DEMAND. lib/cost-budget.ts caps a single prep by
//   arithmetic, and there is no batch endpoint, so the monthly cost of a
//   caseload is (preps actually generated) × (at most SESSION_PREP budget) —
//   not (caseload size) × anything.
//
// So the number worth watching is not total spend, it is COST PER ACTIVE LINK.
// If that starts climbing it means counselors are generating prep for students
// triage did not surface, which is a signal about triage quality long before it
// is a signal about the bill.
//
// WHAT THIS FILE MUST NEVER PRODUCE: a per-counselor ranking, an efficiency
// score, or anything that reads as a judgement of how a professional works.
// A counselor who generates prep for every student is not being wasteful; they
// are telling us triage is not yet trusted, and that is our problem.
import { prisma } from "@/lib/db";
import { estimateCost } from "@/lib/cost";
import { RUN_BUDGET_USD } from "@/lib/cost-budget";

/**
 * The default list price per active link per month.
 *
 * Carried here so the margin arithmetic below has something to compare against.
 * It is NOT read by any billing path — nothing in this app charges anybody —
 * and is deliberately overridable, because the real number is a business
 * decision and not a fact about the code.
 */
export const LIST_PRICE_PER_LINK_USD = envPrice(
  "COUNSELOR_PRICE_PER_LINK_USD",
  12,
);

function envPrice(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export type CaseloadMonthCost = {
  counselorAccountId: string;
  /** For the internal reader to know whose row this is. Never shown to peers. */
  orgName: string | null;
  activeLinks: number;
  caseloadLimit: number;
  /** True when a caseload has outgrown its plan — prep is refused until fixed. */
  overLimit: boolean;
  prepsGenerated: number;
  /** Preps that spent tokens and produced nothing usable. */
  prepsFailed: number;
  modelSpendUsd: number;
  /** The number that matters. Null when there are no active links to divide by. */
  costPerActiveLinkUsd: number | null;
  /** modelSpendUsd against activeLinks × list price. Null for the same reason. */
  grossMarginPct: number | null;
};

/**
 * The window a month's costs are measured over.
 *
 * Calendar month rather than trailing thirty days, because a subscription is
 * billed by the calendar and a cost figure that does not line up with an
 * invoice is a cost figure nobody can reconcile.
 */
export function monthWindow(now = new Date()): { from: Date; to: Date } {
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { from, to };
}

/**
 * Cost per caseload for one month, for every counselor account.
 *
 * Internal only — the route that serves it is gated on an operator allowlist,
 * because this is the one place in the product where one counselor's activity
 * is visible beside another's, and it exists to answer "does the pricing work",
 * not "who is doing well".
 *
 * Failed preps are counted in spend. They burned tokens before failing, and a
 * cost figure that quietly excludes the runs that went wrong is the figure that
 * hides a regression.
 */
export async function loadCaseloadCosts(
  now = new Date(),
): Promise<CaseloadMonthCost[]> {
  const { from, to } = monthWindow(now);

  const accounts = await prisma.counselorAccount.findMany({
    select: {
      id: true,
      orgName: true,
      caseloadLimit: true,
      _count: {
        select: {
          links: { where: { status: "ACTIVE", endedAt: null } },
        },
      },
    },
  });
  if (accounts.length === 0) return [];

  // One query for every prep in the window rather than one per account: an
  // internal screen still runs against a serverless Postgres, and a per-account
  // query is how a report becomes a timeout at the moment it gets interesting.
  const preps = await prisma.sessionPrep.findMany({
    where: { generatedAt: { gte: from, lt: to } },
    select: {
      counselorAccountId: true,
      modelUsed: true,
      inputTokens: true,
      outputTokens: true,
      cacheWriteTokens: true,
      cacheReadTokens: true,
      error: true,
    },
  });

  const byAccount = new Map<
    string,
    { spend: number; total: number; failed: number }
  >();
  for (const p of preps) {
    const entry = byAccount.get(p.counselorAccountId) ?? {
      spend: 0,
      total: 0,
      failed: 0,
    };
    entry.total += 1;
    if (p.error) entry.failed += 1;
    entry.spend += estimateCost(p, p.modelUsed) ?? 0;
    byAccount.set(p.counselorAccountId, entry);
  }

  return accounts.map((a) => {
    const entry = byAccount.get(a.id) ?? { spend: 0, total: 0, failed: 0 };
    const activeLinks = a._count.links;
    const revenue = activeLinks * LIST_PRICE_PER_LINK_USD;
    return {
      counselorAccountId: a.id,
      orgName: a.orgName,
      activeLinks,
      caseloadLimit: a.caseloadLimit,
      overLimit: activeLinks > a.caseloadLimit,
      prepsGenerated: entry.total,
      prepsFailed: entry.failed,
      modelSpendUsd: entry.spend,
      costPerActiveLinkUsd: activeLinks > 0 ? entry.spend / activeLinks : null,
      grossMarginPct:
        revenue > 0 ? ((revenue - entry.spend) / revenue) * 100 : null,
    };
  });
}

/**
 * The worst case a caseload can cost in a month, by arithmetic rather than by
 * observation.
 *
 * Useful because it is the number a pricing decision has to survive: not what
 * counselors did spend, but what they COULD have, if every one of them ran the
 * maximum plausible number of preps against the per-prep ceiling.
 *
 * `prepsPerLinkPerMonth` is the assumption, and it is the caller's to state.
 * Four is one session a week for a student under active work — well above the
 * caseload average, which is the point of a worst case.
 */
export function worstCasePerLinkUsd(prepsPerLinkPerMonth = 4): number {
  return prepsPerLinkPerMonth * RUN_BUDGET_USD.SESSION_PREP;
}

/** Whether an operator may read the internal cost view. */
export function isOperator(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.OPERATOR_EMAILS;
  // Fails CLOSED. An unset allowlist means nobody is an operator, rather than
  // everybody — this gates who may read costs across accounts, so the safe
  // default when it is unconfigured is nobody.
  if (!raw || !raw.trim()) return false;
  const allowed = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
