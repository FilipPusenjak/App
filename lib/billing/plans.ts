// The plan catalogue — one source of truth for what exists and what it costs.
//
// SERVER AND CLIENT SAFE. No database, no Stripe SDK, no session. It is a table
// of facts about products, so it can be imported by a page, a route and a test
// alike without dragging anything behind it.
//
// PRICES ARE A BUSINESS DECISION, NOT A FACT ABOUT THE CODE. Every amount below
// is overridable by environment variable, following the same reasoning as
// LIST_PRICE_PER_LINK_USD in lib/counselor/economics.ts: the number in the repo
// is a starting point that lets the app run, not a commitment.
//
// A price here is DISPLAY ONLY. What a customer is actually charged is whatever
// the Stripe Price identified by stripePriceIdEnv says, because that is the
// object Stripe bills against. If the two disagree, Stripe wins and this file
// is simply lying to the customer — which is why plans.test.ts checks that
// every plan carries a price id env var and why the setup doc tells you to make
// the amounts match.

/** Which surface a plan belongs to. The two are sold separately. */
export type PlanAudience = "STUDENT" | "TUTOR";

export type Plan = {
  code: string;
  audience: PlanAudience;
  name: string;
  /** For display and for the setup doc. Stripe holds the authoritative amount. */
  monthlyUsd: number;
  /** Env var holding this plan's Stripe Price id, e.g. price_1234. */
  stripePriceIdEnv: string;
  /** One line, in the customer's terms rather than ours. */
  summary: string;
  /** Tutors only. How many active students the band covers. */
  caseloadLimit?: number;
};

function usd(envName: string, fallback: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  // A malformed price falls back rather than becoming NaN on a pricing page.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * The free tier every account has without paying anything.
 *
 * It is a real plan rather than the absence of one, so that "what am I on" has
 * an answer for everybody and so the entitlement rules have a value to fall
 * back to when a subscription lapses.
 */
export const STUDENT_FREE: Plan = {
  code: "STUDENT_FREE",
  audience: "STUDENT",
  name: "Free",
  monthlyUsd: 0,
  stripePriceIdEnv: "",
  summary:
    "Build a profile, set targets, and run check-ins. Deep Reviews and plans projections are on Plus.",
};

export const STUDENT_PLUS: Plan = {
  code: "STUDENT_PLUS",
  audience: "STUDENT",
  name: "Plus",
  monthlyUsd: usd("STUDENT_PLUS_PRICE_USD", 9),
  stripePriceIdEnv: "STRIPE_PRICE_STUDENT_PLUS",
  summary:
    "Room to re-run a review after every real change, across the whole application year.",
};

/**
 * The tutor bands, mirrored from lib/testprep/entitlement.ts.
 *
 * CASELOAD_BANDS there stays the definition of what a band IS, because the
 * test-prep engines must keep working with no billing concept in the build at
 * all. This is the same two bands expressed as purchasable things, and a test
 * asserts the two lists agree so they cannot drift apart silently.
 */
export const TUTOR_20: Plan = {
  code: "TUTOR_20",
  audience: "TUTOR",
  name: "Up to 20 students",
  monthlyUsd: usd("TUTOR_20_PRICE_USD", 29),
  stripePriceIdEnv: "STRIPE_PRICE_TUTOR_20",
  summary: "For a part-time or building practice.",
  caseloadLimit: 20,
};

export const TUTOR_50: Plan = {
  code: "TUTOR_50",
  audience: "TUTOR",
  name: "Up to 50 students",
  monthlyUsd: usd("TUTOR_50_PRICE_USD", 49),
  stripePriceIdEnv: "STRIPE_PRICE_TUTOR_50",
  summary: "For a full-time practice.",
  caseloadLimit: 50,
};

export const PLANS: Plan[] = [STUDENT_FREE, STUDENT_PLUS, TUTOR_20, TUTOR_50];

/** Plans a customer can actually buy — everything with a price to charge. */
export const PURCHASABLE_PLANS = PLANS.filter((p) => p.stripePriceIdEnv !== "");

export function planByCode(code: string | null | undefined): Plan | null {
  if (!code) return null;
  return PLANS.find((p) => p.code === code) ?? null;
}

export function plansFor(audience: PlanAudience): Plan[] {
  return PLANS.filter((p) => p.audience === audience);
}

/**
 * The Stripe Price id for a plan, or null when it is not configured.
 *
 * Null is a NORMAL state, not an error: the app is expected to run with no
 * Stripe account at all, and every caller here has to handle that by hiding a
 * checkout button rather than by crashing a page.
 */
export function stripePriceIdFor(plan: Plan): string | null {
  if (!plan.stripePriceIdEnv) return null;
  return process.env[plan.stripePriceIdEnv]?.trim() || null;
}

/** The plan a lapsed or never-subscribed account of this audience falls back to. */
export function defaultPlanFor(audience: PlanAudience): Plan | null {
  return audience === "STUDENT" ? STUDENT_FREE : null;
}
