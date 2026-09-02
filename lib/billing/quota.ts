// How often a plan lets you run the expensive things.
//
// PURE — no database, no session, no Stripe. Same split as lib/spending.ts:
// the rule is testable on its own, and the queries that apply it live in
// quota-account.ts.
//
// WHY INTERVALS RATHER THAN MONTHLY COUNTERS. The product is sold as "one deep
// review every month, weekly plans projections, check in every two days". That
// is a sentence about SPACING, not about a monthly allowance, and the two
// behave differently at the boundary: a counter lets somebody run their January
// review on the 31st and their February one on the 1st, which is not what
// "every month" promised anybody. An interval also gives a much better refusal
// — "your next deep review is available on the 14th" instead of "0 remaining".
//
// THIS SITS ON TOP OF THE SPEND CAP, IT DOES NOT REPLACE IT. The quota is the
// promise made to the customer; lib/spending.ts is the backstop that stops a
// bug or an unusual account running up a bill. Removing either would be a
// mistake: a quota alone bounds frequency but not cost, and a cap alone is
// meaningless to a parent reading a pricing page.
import { STUDENT_FREE, STUDENT_PLUS, type Plan } from "./plans";

/** The three things that cost money to run. */
export const RUN_KINDS = ["DEEP_REVIEW", "PROJECTION", "CHECK_IN"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

/**
 * Title case throughout, because these appear in a list beside each other as
 * often as they appear mid-sentence, and a lowercase entry between two proper
 * nouns reads as a mistake.
 */
export const RUN_LABELS: Record<RunKind, string> = {
  DEEP_REVIEW: "Deep Review",
  PROJECTION: "Plans projection",
  CHECK_IN: "Check-In",
};

/** Minimum days between two runs of each kind. */
export type QuotaPolicy = Record<RunKind, number>;

/**
 * The paid tier, taken verbatim from what the product says it sells.
 *
 * If the Stripe product description changes, change this with it — the two are
 * a promise and its enforcement, and there is a test asserting they agree on
 * the shape.
 */
export const PLUS_QUOTA: QuotaPolicy = {
  DEEP_REVIEW: 30,
  PROJECTION: 7,
  CHECK_IN: 2,
};

/**
 * The free tier.
 *
 * NOT SPECIFIED BY THE PRODUCT — the description covers only the paid plan, so
 * these are a judgement call and should be reviewed rather than inherited. The
 * reasoning: free has to be enough to see whether the app is any good, and
 * little enough that somebody using it seriously subscribes. One review a term
 * does that; a review a month would make the paid tier pointless.
 */
export const FREE_QUOTA: QuotaPolicy = {
  DEEP_REVIEW: 90,
  PROJECTION: 30,
  CHECK_IN: 14,
};

export function quotaFor(plan: Plan | null): QuotaPolicy {
  return plan?.code === STUDENT_PLUS.code ? PLUS_QUOTA : FREE_QUOTA;
}

/** Human phrasing for an interval, for a pricing page or a refusal. */
export function describeInterval(days: number): string {
  if (days === 1) return "daily";
  if (days === 2) return "every two days";
  if (days === 7) return "weekly";
  if (days === 14) return "fortnightly";
  if (days === 30) return "monthly";
  if (days === 90) return "once every three months";
  return `every ${days} days`;
}

export type QuotaDecision =
  | { allowed: true; usingCredit: false }
  /** Blocked by the interval, but a redeemed credit covers it. */
  | { allowed: true; usingCredit: true }
  | {
      allowed: false;
      usingCredit: false;
      nextAvailableAt: Date;
      message: string;
    };

/**
 * May this account run this now?
 *
 * `now` is passed in rather than read from the clock, so the rule is
 * deterministic in tests — the same reason subscriptionGrantsAccess takes one.
 *
 * A CREDIT IS SPENT ONLY WHEN THE QUOTA WOULD OTHERWISE REFUSE. Somebody
 * holding a test code should not burn it on a run they were entitled to
 * anyway, which is exactly what would happen if credits were checked first.
 */
export function checkQuota(input: {
  kind: RunKind;
  lastRunAt: Date | null;
  policy: QuotaPolicy;
  creditsAvailable: number;
  now: Date;
}): QuotaDecision {
  const intervalDays = input.policy[input.kind];

  // A non-positive interval means unlimited — the escape hatch for a
  // deployment that does not want quotas at all.
  if (intervalDays <= 0 || input.lastRunAt === null) {
    return { allowed: true, usingCredit: false };
  }

  const nextAvailableAt = new Date(
    input.lastRunAt.getTime() + intervalDays * 24 * 60 * 60 * 1000,
  );
  if (input.now >= nextAvailableAt) {
    return { allowed: true, usingCredit: false };
  }

  if (input.creditsAvailable > 0) {
    return { allowed: true, usingCredit: true };
  }

  return {
    allowed: false,
    usingCredit: false,
    nextAvailableAt,
    message: refusalMessage(input.kind, nextAvailableAt),
  };
}

/**
 * What a blocked run says.
 *
 * Names the date rather than a countdown, because "available on 14 March" is
 * something somebody can plan around and "available in 9 days" is not. Mentions
 * the code box, since that is the other way through and it is on the same page
 * as the upgrade.
 */
export function refusalMessage(kind: RunKind, nextAvailableAt: Date): string {
  const when = nextAvailableAt.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
  });
  return (
    `Your next ${RUN_LABELS[kind]} is available on ${when}. ` +
    `You can also upgrade your plan, or enter a code if you have one — both are on the plan page.`
  );
}

/** Every kind's standing, for rendering the plan page. */
export type QuotaStanding = {
  kind: RunKind;
  label: string;
  intervalDays: number;
  intervalLabel: string;
  lastRunAt: Date | null;
  nextAvailableAt: Date | null;
  availableNow: boolean;
  credits: number;
};

export function standingFor(input: {
  kind: RunKind;
  lastRunAt: Date | null;
  policy: QuotaPolicy;
  credits: number;
  now: Date;
}): QuotaStanding {
  const intervalDays = input.policy[input.kind];
  const nextAvailableAt =
    intervalDays > 0 && input.lastRunAt
      ? new Date(input.lastRunAt.getTime() + intervalDays * 24 * 60 * 60 * 1000)
      : null;

  return {
    kind: input.kind,
    label: RUN_LABELS[input.kind],
    intervalDays,
    intervalLabel: describeInterval(intervalDays),
    lastRunAt: input.lastRunAt,
    nextAvailableAt,
    availableNow: nextAvailableAt === null || input.now >= nextAvailableAt,
    credits: input.credits,
  };
}

/** The plans this quota system knows about, for the settings page. */
export const QUOTA_PLANS = [
  { plan: STUDENT_FREE, quota: FREE_QUOTA },
  { plan: STUDENT_PLUS, quota: PLUS_QUOTA },
];
