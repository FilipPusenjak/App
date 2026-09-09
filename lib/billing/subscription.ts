// Reading subscription state out of the database.
//
// The rules live in entitlement.ts, free of database and session imports so
// they can be tested directly. This is the part that reaches for data, and it
// is ownership-scoped like everything else: every query filters by ONE
// authenticated user id, never by anything a client supplied.
import { prisma } from "@/lib/db";
import {
  effectivePlan,
  subscriptionGrantsAccess,
  type SubscriptionState,
} from "./entitlement";
import { planByCode, type Plan, type PlanAudience } from "./plans";

/**
 * Every account currently entitled to a paid plan.
 *
 * The one query in this file that is NOT scoped to a single user, because its
 * caller is the retention sweep — a background job with no session, deciding
 * how long to keep each account's data.
 *
 * It reuses subscriptionGrantsAccess rather than expressing "is paying" as a
 * WHERE clause. That rule is subtle in ways SQL would lose: a cancelled
 * subscription still grants access until the period it paid for runs out, and
 * past_due keeps access while Stripe retries. Reimplemented in the query, every
 * one of those cases would silently delete a paying customer's data early,
 * which is the worst thing this system can do.
 *
 * Reads the whole Subscription table, which is bounded by the number of people
 * who have ever paid — an account with no row is free by definition and never
 * needs loading.
 */
export async function userIdsWithPaidAccess(now: Date): Promise<Set<string>> {
  const rows = await prisma.subscription.findMany({
    select: {
      userId: true,
      planCode: true,
      status: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  });

  const paid = new Set<string>();
  for (const row of rows) {
    if (!subscriptionGrantsAccess(row, now)) continue;
    // Audience-blind on purpose: retention asks only whether somebody is
    // paying, so a tutor plan counts the same as a student one. A comped plan
    // priced at zero does not, since it is not what the long window is for.
    const plan = planByCode(row.planCode);
    if (plan && plan.monthlyUsd > 0) paid.add(row.userId);
  }
  return paid;
}

/** Every subscription row this account holds, in the pure rules' shape. */
export async function loadSubscriptionStates(
  userId: string,
): Promise<SubscriptionState[]> {
  const rows = await prisma.subscription.findMany({
    where: { userId },
    select: {
      planCode: true,
      status: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  });
  return rows;
}

/**
 * The plan in force for an account on a surface.
 *
 * `now` is threaded through rather than read inside the rule — see the note on
 * subscriptionGrantsAccess for why.
 */
export async function effectivePlanFor(
  userId: string,
  audience: PlanAudience,
  now: Date = new Date(),
): Promise<Plan | null> {
  return effectivePlan(await loadSubscriptionStates(userId), audience, now);
}

export type BillingSummary = {
  plan: Plan | null;
  /** Present when there is a paid subscription to describe, lapsed or not. */
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** True once this account has a Stripe customer, so the portal is reachable. */
  hasCustomer: boolean;
};

/**
 * What a billing screen needs to render, in one query.
 *
 * Reports the subscription being described even when it is lapsed, because
 * "your plan ended on the 3rd" is the sentence somebody needs, and a screen
 * that simply shows Free with no explanation reads as the app having lost
 * their payment.
 */
export async function loadBillingSummary(
  userId: string,
  audience: PlanAudience,
  now: Date = new Date(),
): Promise<BillingSummary> {
  const [user, rows] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { stripeCustomerId: true },
    }),
    prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        planCode: true,
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    }),
  ]);

  const plan = effectivePlan(rows, audience, now);
  // The newest row for this audience, which is the one worth describing.
  const describing = rows.find(
    (r) => planByCode(r.planCode)?.audience === audience,
  );

  return {
    plan,
    status: describing?.status ?? null,
    currentPeriodEnd: describing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: describing?.cancelAtPeriodEnd ?? false,
    hasCustomer: user.stripeCustomerId !== null,
  };
}
