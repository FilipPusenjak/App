// POST /api/billing/checkout — start a Stripe Checkout Session.
//
// This route never sees a card. It creates a Stripe-hosted Checkout Session and
// returns its URL, and the customer enters their details on Stripe's page. That
// is the entire reason to use Checkout rather than building a payment form: card
// data never touches this app, this origin, or these logs, so the PCI surface
// stays with Stripe where it belongs.
//
// It also does NOT grant anything. Creating a session means somebody clicked a
// button, not that money moved — a session can be abandoned at the card screen,
// and a card can decline. The subscription is written by the webhook, on
// Stripe's say-so, and nowhere else. Granting here is the classic way to hand
// out a paid plan for free by opening a URL.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getCounselorAccount } from "@/lib/counselor/access";
import { planByCode, stripePriceIdFor } from "@/lib/billing/plans";
import { appBaseUrl, isStripeConfigured, requireStripe } from "@/lib/billing/stripe";

const bodySchema = z.object({ planCode: z.string().trim().min(1) });

export async function POST(request: Request) {
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected a planCode." }, { status: 400 });
  }

  const plan = planByCode(parsed.data.planCode);
  if (!plan) {
    return NextResponse.json({ error: "No such plan." }, { status: 400 });
  }

  // A free plan has nothing to charge for, and letting one through would create
  // a zero-amount subscription that then looks paid to the webhook.
  const priceId = stripePriceIdFor(plan);
  if (!priceId) {
    return NextResponse.json(
      { error: "That plan is not purchasable on this deployment." },
      { status: 400 },
    );
  }

  // A tutor band sold to somebody with no tutor account would take money for
  // something they cannot use. Checked here rather than trusted from the client,
  // because planCode arrives in the request body.
  if (plan.audience === "TUTOR") {
    const account = await getCounselorAccount();
    if (!account || account.type !== "TEST_PREP_TUTOR") {
      return NextResponse.json(
        { error: "This plan is for tutor accounts." },
        { status: 403 },
      );
    }
  }

  const stripe = requireStripe();
  const base = appBaseUrl();

  // Reuse this account's Stripe customer if it has one. Creating a second
  // customer for a returning subscriber is how an account ends up with its
  // invoice history split across two records that support cannot reconcile.
  //
  // Read here rather than widening what getCurrentUser selects: a billing id
  // has no business being loaded on every page render in the app.
  const billing = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { stripeCustomerId: true },
  });
  let customerId = billing.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      // The link back. Stripe's dashboard is where a refund or a dispute gets
      // handled, and a customer with no reference to an account id is one
      // nobody can match to anything in here.
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}${plan.audience === "TUTOR" ? "/students-testprep/plan" : "/settings/billing"}?checkout=done`,
    cancel_url: `${base}${plan.audience === "TUTOR" ? "/students-testprep/plan" : "/settings/billing"}?checkout=cancelled`,
    // Carried onto the subscription so the webhook can attribute it without
    // trusting anything the browser sends back. The webhook reads THIS, not a
    // query parameter on the success URL — a success URL is just a redirect the
    // customer can type themselves.
    subscription_data: { metadata: { userId: user.id, planCode: plan.code } },
    client_reference_id: user.id,
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not return a checkout URL." },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: session.url });
}
