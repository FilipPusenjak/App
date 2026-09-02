// Per-account spending cap — SERVER ONLY.
//
// Every account that runs anything spends the OWNER's Anthropic credits. The
// rate limits bound how FAST that happens (a cooldown, a per-hour count); they
// say nothing about the total. This is the total.
//
// Three things it is honest about, because a cap people trust and shouldn't is
// worse than no cap:
//
// 1. IT IS AN ESTIMATE. The figure comes from token counts recorded off each
//    response multiplied by a price table kept in this repo. It is not the
//    bill. Prices change, and this table will drift from them. Treat it as a
//    guard rail, not accounting — the Anthropic console's own limit is the
//    thing that actually cannot be exceeded, and this does not replace it.
//
// 2. IT CAN OVERSHOOT BY ONE RUN. A run's cost is not knowable until it has
//    finished, so the check is "have you already spent the budget", not "will
//    this run fit". Someone at $1.99 can start a run that ends at $2.40. The
//    overshoot is bounded by a single run and cannot compound, because the
//    next check sees the new total.
//
// 3. IT COUNTS FAILURES. A run that failed still burned tokens, and pretending
//    otherwise would let a loop of failing runs spend without limit.
//
// Scoped to the ACCOUNT, not the student. One account can hold a whole
// caseload, and the credits are the account holder's.
//
// POLICY ONLY — no database, no session. The query that applies it lives in
// spending-account.ts, for the same reason stale.ts is separate from
// stale-sweep.ts: importing the session layer here would drag next-auth into
// every consumer, and the rule could no longer be tested on its own.

/**
 * Default budget per account, in USD.
 *
 * Three, not two. A Deep Review measures at roughly $0.19 and a check-in at
 * $0.02, so two dollars bought about ten strategy reviews across a four-year
 * account — a cap tight enough to stop the app being used rather than to stop
 * it running away. Raise it deliberately with ACCOUNT_SPEND_LIMIT_USD; the
 * point of a default is to be a floor under a mistake, not a budget.
 */
export const DEFAULT_SPEND_LIMIT_USD = 3;

/**
 * The configured cap. Zero or negative disables the cap entirely; a malformed
 * value falls back to the default rather than to "unlimited", because an
 * unparseable number should never silently remove a spending guard.
 */
export function getSpendLimitUsd(): number {
  const raw = process.env.ACCOUNT_SPEND_LIMIT_USD?.trim();
  if (!raw) return DEFAULT_SPEND_LIMIT_USD;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SPEND_LIMIT_USD;
  return parsed;
}

export type SpendStatus = {
  spentUsd: number;
  limitUsd: number;
  /** False when the account has already spent its budget. */
  allowed: boolean;
  /** Never negative — "you are $0.00 under" reads better than a minus sign. */
  remainingUsd: number;
  /** True when no cap is in force. */
  unlimited: boolean;
};

/** Apply the cap to a spend total. Pure, so the rule is testable on its own. */
export function evaluateSpend(spentUsd: number, limitUsd: number): SpendStatus {
  const spent = Number.isFinite(spentUsd) && spentUsd > 0 ? spentUsd : 0;
  const unlimited = !Number.isFinite(limitUsd) || limitUsd <= 0;

  if (unlimited) {
    return {
      spentUsd: spent,
      limitUsd,
      allowed: true,
      remainingUsd: Number.POSITIVE_INFINITY,
      unlimited: true,
    };
  }

  return {
    spentUsd: spent,
    limitUsd,
    // At the limit is over it: ">= " rather than "> ", so a budget that has
    // been exactly consumed does not buy one more run.
    allowed: spent < limitUsd,
    remainingUsd: Math.max(limitUsd - spent, 0),
    unlimited: false,
  };
}

/** The message shown when a run is refused. Written to be read by a student. */
export function spendLimitMessage(status: SpendStatus): string {
  return (
    `This account has used about $${status.spentUsd.toFixed(2)} of its ` +
    `$${status.limitUsd.toFixed(2)} AI budget, so new evaluations are paused. ` +
    `Nothing has been lost — every past evaluation is still here. ` +
    `The budget is set by whoever runs this app.`
  );
}
