// Applying a Stripe subscription event to local state.
//
// Split out of the route so it can be tested without an HTTP layer or a real
// signature: the route's job is to verify the request came from Stripe, and
// this module's job is to apply a verified event correctly. Those fail in
// different ways and deserve separate tests.
//
// THE TWO PROPERTIES THAT MATTER, because Stripe guarantees neither:
//
//   AT-LEAST-ONCE, NOT EXACTLY-ONCE. Stripe retries on any non-2xx and can
//   deliver the same event more than once regardless. So every apply is
//   deduplicated on the event id, and the dedup row is written in the SAME
//   transaction as the effect — a crash between the two would otherwise either
//   lose the change or mark it done without doing it.
//
//   UNORDERED. Deliveries can arrive out of order, and a retried old event can
//   land after a newer one. Applying a stale `customer.subscription.updated`
//   after a cancellation would silently resurrect a subscription nobody is
//   paying for, so every apply refuses to overwrite state stamped later than
//   itself.
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { planByCode } from "./plans";

/** The events this app acts on. Anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

export type ApplyOutcome =
  | { applied: true; subscriptionId: string }
  | { applied: false; reason: "duplicate" | "stale" | "unhandled" | "unattributable" };

/**
 * Apply one verified Stripe event.
 *
 * Returns rather than throws for every expected non-application, because a
 * duplicate is a SUCCESS from Stripe's point of view: throwing would return a
 * non-2xx and cause Stripe to retry the thing that already happened, forever.
 */
export async function applySubscriptionEvent(
  event: Stripe.Event,
): Promise<ApplyOutcome> {
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) {
    return { applied: false, reason: "unhandled" };
  }

  const sub = event.data.object as Stripe.Subscription;
  const eventAt = new Date(event.created * 1000);

  // Who does this belong to? The metadata written at checkout is authoritative;
  // the customer id is the fallback for a subscription created in the Stripe
  // dashboard by hand, which is a real thing operators do.
  const userId =
    (sub.metadata?.userId as string | undefined) ??
    (await userIdForCustomer(sub.customer));
  if (!userId) return { applied: false, reason: "unattributable" };

  const planCode = resolvePlanCode(sub);
  if (!planCode) return { applied: false, reason: "unattributable" };

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const periodEnd = subscriptionPeriodEnd(sub);

  try {
    return await prisma.$transaction(async (tx) => {
      // The dedup gate. A duplicate delivery hits the unique id and aborts the
      // whole transaction, which is exactly the intent: no effect, no row.
      await tx.stripeEvent.create({
        data: { id: event.id, type: event.type, stripeCreatedAt: eventAt },
      });

      const existing = await tx.subscription.findUnique({
        where: { stripeSubscriptionId: sub.id },
        select: { id: true, lastEventAt: true },
      });

      // Ordering. An event older than what has already been applied is dropped
      // rather than written — but its dedup row above still stands, so Stripe
      // stops retrying it.
      if (existing?.lastEventAt && existing.lastEventAt > eventAt) {
        return { applied: false, reason: "stale" as const };
      }

      const data = {
        userId,
        planCode,
        stripeCustomerId:
          typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        stripePriceId: priceId,
        // Stripe's status is stored verbatim rather than narrowed — see the
        // schema comment for why past_due and canceled must stay distinct.
        status:
          event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        lastEventAt: eventAt,
      };

      await tx.subscription.upsert({
        where: { stripeSubscriptionId: sub.id },
        create: { ...data, stripeSubscriptionId: sub.id },
        update: data,
      });

      return { applied: true as const, subscriptionId: sub.id };
    });
  } catch (error) {
    // A unique violation on StripeEvent.id means this delivery is a duplicate.
    // Reported as handled so the route answers 200 and Stripe stops retrying.
    if (isUniqueViolation(error)) {
      return { applied: false, reason: "duplicate" };
    }
    throw error;
  }
}

/**
 * The plan a subscription is for.
 *
 * Metadata first, then a reverse lookup from the Stripe Price id, so a
 * subscription created by hand in the dashboard still resolves. Returns null
 * rather than guessing — a subscription attributed to the wrong plan grants the
 * wrong thing, and no grant at all is the safer error.
 */
export function resolvePlanCode(sub: Stripe.Subscription): string | null {
  const fromMetadata = sub.metadata?.planCode as string | undefined;
  if (fromMetadata && planByCode(fromMetadata)) return fromMetadata;

  const priceId = sub.items?.data?.[0]?.price?.id;
  if (!priceId) return null;

  // The catalogue holds env var NAMES, so this compares against their values.
  for (const plan of [
    "STUDENT_PLUS",
    "TUTOR_20",
    "TUTOR_50",
  ]) {
    const configured = planByCode(plan);
    if (!configured?.stripePriceIdEnv) continue;
    if (process.env[configured.stripePriceIdEnv]?.trim() === priceId) {
      return plan;
    }
  }
  return null;
}

/**
 * When the paid-for period ends.
 *
 * Stripe moved this off the subscription and onto its items, so it is read from
 * the item rather than from a top-level field that newer API versions no longer
 * populate. Null when absent, which the entitlement rules treat as "no paid
 * runway left" rather than as "forever".
 */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0];
  const seconds =
    (item as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

async function userIdForCustomer(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): Promise<string | null> {
  const id = typeof customer === "string" ? customer : customer.id;
  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: id },
    select: { id: true },
  });
  return user?.id ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
