// What a subscription entitles an account to — the rules, on their own.
//
// PURE. No database, no Stripe SDK, no session. Every function here takes plain
// values and returns plain values, for the same reason lib/spending.ts is
// separate from lib/spending-account.ts: a billing rule that can only be
// exercised by standing up Postgres and a Stripe account is a billing rule
// nobody will test, and this is the layer where being wrong costs money or
// wrongly denies somebody something they paid for.
//
// THREE RULES THAT ARE NOT NEGOTIABLE, each written here once so every caller
// inherits them:
//
// 1. A LAPSE NEVER DESTROYS ACCESS TO WHAT SOMEBODY ALREADY HAS. Downgrading
//    lowers the ceiling on NEW expensive work. It does not hide an evaluation
//    already run, a profile already written, or a score already recorded. A
//    student's own record is theirs; holding it hostage to a card that expired
//    is not a business model this app is going to have.
//
// 2. PAID-FOR TIME IS HONOURED TO THE END. Somebody who cancels on the 2nd
//    keeps the plan until the period ends, because they paid for the month.
//    Cancellation sets an end date; it is not an eviction.
//
// 3. THE TUTOR'S BANDS STAY SOFT. Over-band notifies and never blocks, never
//    auto-upgrades, and never touches the stopping signal — see the header of
//    lib/testprep/entitlement.ts for why. Billing arriving in the codebase is
//    exactly the moment that rule would get quietly broken, so the function
//    that decides it lives here and says so.
import {
  STUDENT_FREE,
  planByCode,
  type Plan,
  type PlanAudience,
} from "./plans";

/**
 * Stripe subscription statuses that mean "this person is paying and current".
 *
 * `trialing` counts: a trial is a deliberate grant of the plan, and treating a
 * trialist as unpaid would make the trial useless. `past_due` does NOT count as
 * current on its own — but see subscriptionGrantsAccess, which keeps access
 * until the paid period actually ends rather than cutting it at the first
 * failed charge, because the overwhelmingly common cause is an expired card and
 * the overwhelmingly common fix takes a few days.
 */
export const CURRENT_STATUSES = ["active", "trialing"] as const;

/** Statuses where Stripe has given up and the subscription is over. */
export const DEAD_STATUSES = [
  "canceled",
  "unpaid",
  "incomplete_expired",
] as const;

export type SubscriptionState = {
  planCode: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/**
 * Does this subscription entitle the holder to its plan right now?
 *
 * The `now` argument is required rather than defaulted to `new Date()` so that
 * every caller is explicit and every test is deterministic — a billing rule
 * that reads the clock internally is one that behaves differently at midnight
 * on the last day of a period, which is exactly when it matters.
 */
export function subscriptionGrantsAccess(
  sub: SubscriptionState,
  now: Date,
): boolean {
  if ((DEAD_STATUSES as readonly string[]).includes(sub.status)) {
    // Even a canceled subscription keeps the plan until the period it paid for
    // has actually run out. Stripe sets status to canceled the moment somebody
    // cancels, so treating that as immediate would take away time they bought.
    return sub.currentPeriodEnd !== null && sub.currentPeriodEnd > now;
  }

  if ((CURRENT_STATUSES as readonly string[]).includes(sub.status)) return true;

  // past_due, incomplete, paused: Stripe is retrying or waiting. Keep access
  // for the period already paid for and let the dunning emails do their work.
  // Being wrong in this direction costs one month of a plan; being wrong in the
  // other direction locks a paying customer out over a card that expired.
  if (sub.currentPeriodEnd !== null && sub.currentPeriodEnd > now) return true;

  return false;
}

/**
 * The plan actually in force for an account, given every subscription it holds.
 *
 * Picks the most generous plan among those currently granting access, rather
 * than the newest. An account holding both a lapsed Plus and an active Free
 * should read as Plus while the paid period lasts, and an account that upgraded
 * mid-month may briefly hold two live rows.
 */
export function effectivePlan(
  subs: SubscriptionState[],
  audience: PlanAudience,
  now: Date,
): Plan | null {
  const live = subs
    .filter((s) => subscriptionGrantsAccess(s, now))
    .map((s) => planByCode(s.planCode))
    .filter((p): p is Plan => p !== null && p.audience === audience);

  if (live.length === 0) {
    // Students always land on the free plan; there is no free tutor band, and
    // null there is the honest answer rather than an invented one.
    return audience === "STUDENT" ? STUDENT_FREE : null;
  }

  return live.reduce((best, p) => (p.monthlyUsd > best.monthlyUsd ? p : best));
}

/**
 * The spend ceiling an account gets, in USD.
 *
 * Returns null to mean "no plan opinion, use the environment default", which
 * keeps a deployment that has never configured billing behaving exactly as it
 * did before this file existed — see getSpendLimitUsd in lib/spending.ts.
 */
export function spendLimitForPlan(plan: Plan | null): number | null {
  return plan?.spendLimitUsd ?? null;
}

export type BandStanding = {
  /** Active students the tutor is actually working with. */
  active: number;
  /** What their current plan covers. */
  limit: number;
  overBand: boolean;
  /** Never an interruption. Copy for a notice, or null when inside the band. */
  message: string | null;
};

/**
 * How being over a band is communicated — and everything it does NOT do.
 *
 * Returns a MESSAGE. Not a boolean called `blocked`, not a `disabled` flag, not
 * a redirect target. The shape of this return value is deliberate: there is no
 * field here that a caller could wire to a disabled button even by accident,
 * because the moment such a field exists somebody will use it during a session
 * with a parent in the room.
 *
 * It also never chooses a band. Auto-upgrading somebody who is over by one
 * student is charging them $20 for a decision they did not make.
 */
export function bandStanding(input: {
  active: number;
  limit: number;
  suggestedName: string | null;
}): BandStanding {
  const overBand = input.active > input.limit;
  if (!overBand) {
    return {
      active: input.active,
      limit: input.limit,
      overBand: false,
      message: null,
    };
  }

  const over = input.active - input.limit;
  const suggestion = input.suggestedName
    ? ` ${input.suggestedName} would cover you.`
    : " Get in touch and we will sort out a plan that fits.";

  return {
    active: input.active,
    limit: input.limit,
    overBand: true,
    message:
      `You are working with ${input.active} students on a plan that covers ` +
      `${input.limit} — ${over} over.${suggestion} Nothing is limited in the ` +
      `meantime, and nothing changes unless you change it.`,
  };
}

/**
 * Whether a lapse may hide something.
 *
 * The answer is no, and this function exists to be the single place that says
 * so and the single thing a test has to hold. It takes the kind of thing being
 * asked about so that a future caller adding a new kind has to come here and
 * think, rather than defaulting to "paywall it".
 */
export function planMayGate(
  kind:
    | "NEW_EXPENSIVE_RUN"
    | "EXISTING_EVALUATION"
    | "OWN_PROFILE_DATA"
    | "STOPPING_SIGNAL"
    | "EXPORT_OWN_DATA",
): boolean {
  // Only the first. Everything else is either the customer's own record or the
  // one signal this product exists to deliver.
  return kind === "NEW_EXPENSIVE_RUN";
}
