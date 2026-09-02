// Closing an account's billing before the account itself is deleted.
//
// THE BUG THIS EXISTS TO PREVENT: deleting a User cascades the Subscription row
// away, and Stripe never finds out. The subscription stays active, the card
// keeps being charged monthly, and there is no longer an account to log into to
// stop it. Nobody notices until a stranger's bank statement does.
//
// So Stripe is told FIRST, and the account is deleted only if it worked.
//
// WHAT CANNOT BE DELETED, and why saying so matters: Stripe retains invoice
// and payment records after a customer is deleted, because tax and accounting
// law in most jurisdictions requires it for years. Deleting the customer object
// detaches the name, email and card details; the transaction record survives.
// The deletion UI says this outright rather than promising an erasure that is
// not legally available.
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { getStripe } from "./stripe";

export type CloseBillingResult = {
  /** True when there was nothing to close, or it was closed successfully. */
  ok: boolean;
  subscriptionsCancelled: number;
  customerDeleted: boolean;
  /** Set when Stripe refused. The caller must NOT delete the account. */
  error?: string;
};

/**
 * Cancel this account's subscriptions and delete its Stripe customer.
 *
 * Cancels immediately rather than at period end: the account is about to stop
 * existing, so leaving it running to the end of a month somebody can no longer
 * use is charging for nothing. A partial month is Stripe's proration to settle.
 */
export async function closeBillingForUser(
  userId: string,
): Promise<CloseBillingResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });

  // No customer means this account never opened checkout. Nothing to close, and
  // that is a success rather than a condition to report.
  if (!user?.stripeCustomerId) {
    return { ok: true, subscriptionsCancelled: 0, customerDeleted: false };
  }

  const stripe = getStripe();
  if (!stripe) {
    // Billing was configured when they subscribed and is not configured now.
    // Refuse rather than proceed: deleting the account here is precisely how
    // somebody ends up paying forever for something that no longer exists.
    return {
      ok: false,
      subscriptionsCancelled: 0,
      customerDeleted: false,
      error:
        "This account has a payment record but billing is not configured, so the subscription cannot be cancelled. Nothing has been deleted.",
    };
  }

  try {
    // Ask STRIPE what is active, not the local table. The local row is a cache
    // and this is the one moment where believing a stale cache means charging
    // somebody indefinitely.
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      limit: 100,
    });

    let cancelled = 0;
    for (const sub of subs.data) {
      if (sub.status === "canceled" || sub.status === "incomplete_expired") {
        continue;
      }
      await stripe.subscriptions.cancel(sub.id);
      cancelled += 1;
    }

    // Deleting the customer detaches the PII Stripe holds — name, email, card.
    // Invoices survive, by legal necessity.
    await stripe.customers.del(user.stripeCustomerId);

    return { ok: true, subscriptionsCancelled: cancelled, customerDeleted: true };
  } catch (error) {
    // A customer already deleted in the dashboard is not a failure — there is
    // nothing left to bill, which is the outcome we wanted.
    if (
      error instanceof Stripe.errors.StripeError &&
      error.code === "resource_missing"
    ) {
      return { ok: true, subscriptionsCancelled: 0, customerDeleted: false };
    }

    return {
      ok: false,
      subscriptionsCancelled: 0,
      customerDeleted: false,
      error:
        "Could not cancel the subscription with Stripe, so nothing has been deleted. Try again in a moment.",
    };
  }
}
