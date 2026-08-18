// Which stored rows genuinely belong to which tier.
//
// `type` alone is NOT sufficient for DEEP_REVIEW, and the reason is a schema
// default that looks harmless: Evaluation.type defaults to "DEEP_REVIEW", so
// every legacy percentile evaluation ever written carries it too.
//
// The consequence was not cosmetic. The 21-day floor looks for the most recent
// row of this type, found a legacy evaluation from hours earlier, and refused
// every Deep Review for three weeks — an account that had never run one was
// locked out of running its first. The prior-review context had the same fault
// from the other end, and would have fed legacy rows in as previous reviews
// whose headlines do not exist in that shape.
//
// promptVersion is the honest discriminator: never defaulted, and written by
// the route that actually produced the row.
//
// This module is deliberately free of database imports. The same rule has to
// hold in a Prisma `where` and over rows already in memory, and the only way
// to keep those two from drifting is for both to be spelled here, next to each
// other, in code a unit test can reach.
import type { EvaluationType } from "@/lib/validation/tiers";

/** Every deep-review prompt version starts with this, and nothing else does. */
export const DEEP_REVIEW_VERSION_PREFIX = "deep-review/";

/**
 * The tier predicate as a Prisma filter.
 *
 * CHECK_IN needs no promptVersion guard, and must not have one — a no-change
 * check-in deliberately stores no promptVersion at all, and requiring one would
 * drop the very rows the next check-in measures itself against. Nothing is ever
 * wrongly typed CHECK_IN, because that is not the default.
 */
export function tierWhere(type: EvaluationType) {
  return type === "DEEP_REVIEW"
    ? { type, promptVersion: { startsWith: DEEP_REVIEW_VERSION_PREFIX } }
    : { type };
}

/**
 * The same predicate over a row already loaded, plus the two conditions that
 * decide whether a row counts as a review the student actually received: a
 * failed run never started the clock, and a sample was never theirs.
 *
 * Used by the page that shows the 21-day floor, so what the student reads and
 * what the route enforces are computed from one rule.
 */
export function isDeepReviewRow(row: {
  promptVersion: string | null;
  status: string;
  isSample: boolean;
}): boolean {
  return (
    row.promptVersion?.startsWith(DEEP_REVIEW_VERSION_PREFIX) === true &&
    row.status === "completed" &&
    !row.isSample
  );
}
