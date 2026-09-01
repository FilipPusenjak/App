// POST /api/billing/portal — open the Stripe billing portal.
//
// Upgrades, downgrades, cancellation, card changes, invoice history and receipts
// are all Stripe's hosted portal rather than screens in this app. That is a
// deliberate trade: every one of those flows has edge cases involving proration,
// tax, dunning and refunds that are Stripe's job to get right, and re-earning
// them here would mean re-earning them badly.
//
// It also means cancellation is never harder than subscribing, which is both the
// decent thing and, in several jurisdictions, the legal one.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { appBaseUrl, isStripeConfigured, requireStripe } from "@/lib/billing/stripe";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured on this deployment." },
      { status: 503 },
    );
  }

  // No customer means this account has never checked out, so there is nothing
  // for a portal to show. Said plainly rather than creating an empty customer,
  // which would leave a trail of blank records for everyone who clicked once.
  const billing = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { stripeCustomerId: true },
  });
  if (!billing.stripeCustomerId) {
    return NextResponse.json(
      { error: "This account has no billing history yet." },
      { status: 400 },
    );
  }

  const stripe = requireStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: billing.stripeCustomerId,
    return_url: `${appBaseUrl()}/settings/billing`,
  });

  return NextResponse.json({ url: session.url });
}
