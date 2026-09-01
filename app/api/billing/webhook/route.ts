// POST /api/billing/webhook — Stripe's report of what actually happened.
//
// THIS IS THE ONLY THING THAT GRANTS A PLAN. Not the checkout route, not the
// success URL. A success URL is a redirect the customer's browser follows, and
// anybody can type one; this endpoint carries a signature only Stripe can
// produce. Treating the redirect as proof of payment is the single most common
// way a subscription app gives its product away.
//
// UNAUTHENTICATED BY NECESSITY, AUTHENTICATED BY SIGNATURE. Stripe has no
// session here, so the request cannot be tied to a logged-in user — the
// signature is what makes it trustworthy, and every request without a valid one
// is refused before a single byte of its body is believed.
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getStripe,
  isStripeConfigured,
  stripeWebhookSecret,
} from "@/lib/billing/stripe";
import { applySubscriptionEvent } from "@/lib/billing/webhook";

/**
 * Node runtime, not edge: the Stripe SDK's signature verification uses Node
 * crypto, and this route needs the raw body, which the edge runtime handles
 * differently.
 */
export const runtime = "nodejs";
/** Never cached. A webhook is a command, not a document. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = stripeWebhookSecret();

  // A deployment with no billing configured should not accept webhooks at all.
  // 503 rather than 200 so a misconfiguration is visible in Stripe's dashboard
  // as failed deliveries instead of silently swallowing real events.
  if (!isStripeConfigured() || !stripe || !secret) {
    return NextResponse.json(
      { error: "Billing is not configured on this deployment." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "No signature." }, { status: 400 });
  }

  // The RAW body, before any JSON parsing. The signature covers the exact bytes
  // Stripe sent, so parsing and re-serialising first would break verification
  // for entirely valid requests.
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    // Deliberately no detail. A caller probing this endpoint learns only that
    // the signature failed, never why or how close it got.
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  try {
    const outcome = await applySubscriptionEvent(event);
    // 200 for every expected outcome INCLUDING duplicates and events we ignore.
    // A non-2xx tells Stripe to retry, and retrying a duplicate forever is not
    // a useful thing to ask it to do.
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    // A genuine failure — a database outage, a bug. 500 so Stripe retries with
    // backoff, which is exactly what should happen to an event that has not
    // been applied yet.
    console.error("[billing] failed to apply Stripe event", event.id, error);
    return NextResponse.json(
      { error: "Failed to apply event." },
      { status: 500 },
    );
  }
}
