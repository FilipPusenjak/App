// How often a plan lets you run the expensive things.
//
// PURE — no database, no session, no Stripe. The rule is testable on its own,
// and the queries that apply it live in quota-account.ts.
//
// WHY INTERVALS RATHER THAN MONTHLY COUNTERS. The product is sold as "one deep
// review every month, weekly plans projections, check in every two days". That
// is a sentence about SPACING, not about a monthly allowance, and the two
// behave differently at the boundary: a counter lets somebody run their January
// review on the 31st and their February one on the 1st, which is not what
// "every month" promised anybody. An interval also gives a much better refusal
// — "your next deep review is available on the 14th" instead of "0 remaining".
//
// THIS IS THE WHOLE SPEND CONTROL NOW, not one layer under a separate
// account-level dollar cap — that cap (lib/spending.ts, formerly) was removed
// deliberately: showing anybody a running total taught them what a run costs
// to produce, which this app does not want visible. What still bounds a single
// run's cost is the per-run budget (lib/cost-budget.ts) sizing the model's
// output allowance; what bounds an account's total is this interval, which is
// a promise stated in the product rather than a number nobody but the operator
// ever saw. A bug in this file is no longer caught by a second gate underneath
// it — get the interval right.
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

/**
 * What a plan allows, per run kind.
 *
 * Three distinct values, and the distinction matters because they produce three
 * different sentences to a customer:
 *
 *   a positive number — the minimum days between runs. "Next one on 5 July."
 *   zero or negative  — unlimited. The escape hatch for a deployment that does
 *                       not want quotas at all.
 *   null              — NOT INCLUDED in this plan at all. "Deep Reviews are on
 *                       the Plus plan." Not a wait, a different plan.
 *
 * null is deliberately not expressed as a very large interval: "available on 12
 * March 2031" is a worse thing to tell somebody than "this is not on your plan",
 * and a caller rendering a date would have to special-case the number anyway.
 */
export type QuotaPolicy = Record<RunKind, number | null>;

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
 * DEEP REVIEWS AND PROJECTIONS ARE NOT ON IT. They are the two runs that cost
 * real model money, and anyone can sign up — there is no invite list any more —
 * so a free tier that included them would let a stranger spend the deployment's
 * API budget on their first afternoon. The spend cap bounds the damage but does
 * not prevent it, and a cap hit by strangers is a cap that is not there for
 * paying customers.
 *
 * What free still does: build a profile, set targets, keep every past result and
 * the score chart, export everything, and run a check-in. A code redeemed on the
 * plan page still buys a single Deep Review or projection — that path
 * deliberately survives this, since handing out codes is how the app gets tried
 * without a card.
 */
export const FREE_QUOTA: QuotaPolicy = {
  DEEP_REVIEW: null,
  PROJECTION: null,
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
  /** Blocked by the interval or by the plan, but a redeemed credit covers it. */
  | { allowed: true; usingCredit: true }
  | {
      allowed: false;
      usingCredit: false;
      /**
       * Which of the two refusals this is. They need different words and, for a
       * caller, different offers: waiting fixes one and only upgrading or a code
       * fixes the other.
       */
      reason: "interval" | "not-on-plan";
      /** Null when the plan does not include this at all — no date would be true. */
      nextAvailableAt: Date | null;
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

  // Not on this plan at all. Note there is no first-run exemption here, unlike
  // the interval below: "not included" has to mean the first one too, or free
  // would quietly ship one of everything.
  if (intervalDays === null) {
    if (input.creditsAvailable > 0) {
      return { allowed: true, usingCredit: true };
    }
    return {
      allowed: false,
      usingCredit: false,
      reason: "not-on-plan",
      nextAvailableAt: null,
      message: notOnPlanMessage(input.kind),
    };
  }

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
    reason: "interval",
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
    `You can also upgrade in Settings → Plan, or enter a code there if you have one.`
  );
}

/**
 * What a run the plan does not include says.
 *
 * Deliberately NOT phrased as a date. Telling somebody on the free plan that
 * their next Deep Review is "available in 2031" would be a lie dressed as a
 * schedule; the honest answer is that waiting will not help and there are two
 * things that will.
 */
export function notOnPlanMessage(kind: RunKind): string {
  return (
    `${RUN_LABELS[kind]}s are part of the Plus plan. ` +
    `You can upgrade in Settings → Plan, or enter a code there if you have one.`
  );
}

/** Every kind's standing, for rendering the plan page. */
export type QuotaStanding = {
  kind: RunKind;
  label: string;
  /** Null when the plan does not include this run at all. */
  intervalDays: number | null;
  /** "monthly", "no limit", or "not on your plan" — always something to print. */
  intervalLabel: string;
  /** False when only a code can buy this run on the current plan. */
  includedInPlan: boolean;
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
  const includedInPlan = intervalDays !== null;
  const nextAvailableAt =
    intervalDays !== null && intervalDays > 0 && input.lastRunAt
      ? new Date(input.lastRunAt.getTime() + intervalDays * 24 * 60 * 60 * 1000)
      : null;

  return {
    kind: input.kind,
    label: RUN_LABELS[input.kind],
    intervalDays,
    intervalLabel:
      intervalDays === null
        ? "not on your plan"
        : intervalDays > 0
          ? describeInterval(intervalDays)
          : "no limit",
    includedInPlan,
    lastRunAt: input.lastRunAt,
    nextAvailableAt,
    // A held credit is what makes this runnable right now on a plan that does
    // not include it — the page would otherwise say "not on your plan" beside a
    // badge saying the account holds a code for exactly this.
    availableNow: includedInPlan
      ? nextAvailableAt === null || input.now >= nextAvailableAt
      : input.credits > 0,
    credits: input.credits,
  };
}

/** The plans this quota system knows about, for the settings page. */
export const QUOTA_PLANS = [
  { plan: STUDENT_FREE, quota: FREE_QUOTA },
  { plan: STUDENT_PLUS, quota: PLUS_QUOTA },
];
