// The Stripe client — SERVER ONLY.
//
// CONSTRUCTED LAZILY, AND ABSENCE IS A NORMAL STATE. This app is expected to
// run with no Stripe account configured at all: that is how it runs in
// development, in CI, in every test, and on any deployment whose owner has not
// set billing up. So there is no module-level `new Stripe(...)` here — that
// would throw at import time and take down every page that transitively
// imported anything billing-related, including pages with no billing on them.
//
// The rule callers follow: ask `isStripeConfigured()` and render accordingly.
// A page with no Stripe keys shows an explanatory line, never a button that
// throws when pressed.
import Stripe from "stripe";

/**
 * Pinned rather than floating: an API version change is a code change.
 *
 * This must match the version the installed SDK's types are generated against,
 * so a dependency bump that moves it fails the typecheck here rather than
 * drifting silently against a live API.
 */
const API_VERSION = "2026-08-26.dahlia";

let cached: Stripe | null = null;

export function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

/** True when this deployment can actually talk to Stripe. */
export function isStripeConfigured(): boolean {
  return stripeSecretKey() !== null;
}

/**
 * The client, or null when unconfigured.
 *
 * Returns null rather than throwing so that "is billing available" is a branch
 * a caller can take, not an exception it has to catch.
 */
export function getStripe(): Stripe | null {
  const key = stripeSecretKey();
  if (!key) return null;
  if (cached) return cached;
  cached = new Stripe(key, { apiVersion: API_VERSION });
  return cached;
}

/**
 * The client, or an error naming what to configure.
 *
 * For the inside of a route that has already established billing is on. The
 * message is deliberately about configuration rather than about the customer,
 * because reaching it means the operator has half-configured the app and the
 * customer can do nothing about it.
 */
export function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY (see DEPLOYMENT.md).",
    );
  }
  return stripe;
}

/**
 * Where Stripe should send the customer back to.
 *
 * Falls back through the same chain scripts/reset-link.ts uses, and refuses to
 * guess: a return URL pointing at the wrong host sends a paying customer to
 * somebody else's deployment, so an unset one is an error rather than a
 * localhost default that would ship to production unnoticed.
 */
export function appBaseUrl(): string {
  const candidates = [
    process.env.APP_URL,
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed.replace(/\/+$/, "");
  }
  throw new Error(
    "No base URL set. Set APP_URL so Stripe can return the customer to this app.",
  );
}
