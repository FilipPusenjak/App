// In-app purchases from the native apps, store-neutral half.
//
// Apple and Google sell Student Plus inside the iOS and Android apps; Stripe
// sells it on the web. All three end up as a Subscription row, and every rule
// about what a row entitles somebody to (lib/billing/entitlement.ts) reads it
// the same way. So this module's job is narrow: turn what a store says about a
// subscription into the row shape those rules already understand, and refuse
// to let a receipt land on an account it was not bought by.
//
// THE STORE IS THE SOURCE OF TRUTH, as Stripe is for web rows. A row here is a
// cache of a signed statement from Apple or Google, never something the client
// asserted. Nothing in this module takes the client's word for a product, a
// date or an account.
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { STUDENT_PLUS } from "./plans";

export type StoreProvider = "APPLE" | "GOOGLE";

/**
 * Store product ids for Student Plus — the only plan sold in the apps.
 *
 * Overridable because the ids are whatever gets created in App Store Connect
 * and Play Console, and an Apple product id can never be reused once deleted.
 * The defaults are what docs/app-store.md tells the owner to create.
 */
export function storeProductIds() {
  return {
    apple: process.env.APPLE_PRODUCT_STUDENT_PLUS?.trim() || "app.coursechart.plus.monthly",
    google: process.env.GOOGLE_PRODUCT_STUDENT_PLUS?.trim() || "student_plus",
  };
}

/** The plan a store product unlocks, or null for a product we do not sell. */
export function planCodeForStoreProduct(
  provider: StoreProvider,
  productId: string | null | undefined,
): string | null {
  if (!productId) return null;
  const ids = storeProductIds();
  const ours = provider === "APPLE" ? ids.apple : ids.google;
  return productId === ours ? STUDENT_PLUS.code : null;
}

/** What the in-app purchase screen needs to find the product in each store. */
export function storeProductConfig() {
  const ids = storeProductIds();
  return {
    appleProductId: ids.apple,
    googleProductId: ids.google,
    // A Play subscription is bought through one of its base plans.
    googleBasePlanId: process.env.GOOGLE_BASE_PLAN_STUDENT_PLUS?.trim() || "monthly",
  };
}

/** The app's identifier in both stores. Fixed: see mobile/capacitor.config.ts. */
export const APP_BUNDLE_ID = "app.coursechart";

/**
 * The row key for a store subscription.
 *
 * Apple's originalTransactionId is stable across every renewal of one
 * subscription. Google's purchaseToken is too, but it is long and opaque, so it
 * is hashed to a fixed width — the key only has to be unique and repeatable.
 */
export function storeSubscriptionKey(provider: StoreProvider, id: string): string {
  return provider === "APPLE"
    ? `apple_${id}`
    : `google_${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

/**
 * What the store says about one subscription, already verified.
 *
 * `status` uses the same vocabulary as Stripe rows, so the entitlement rules
 * need no store-specific branch:
 *   active    — renewing, or cancelled but not yet expired (cancelAtPeriodEnd)
 *   past_due  — renewal payment failing, still inside a grace period
 *   canceled  — expired, refunded or revoked; currentPeriodEnd says when
 */
export type StoreSubscriptionState = {
  provider: StoreProvider;
  /** originalTransactionId (Apple) or purchaseToken (Google). */
  storeId: string;
  planCode: string;
  status: "active" | "past_due" | "canceled";
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** When the store signed this statement — orders out-of-order deliveries. */
  signedAt: Date;
  /** Apple's appAccountToken / Google's obfuscatedExternalAccountId, if any. */
  accountToken: string | null;
};

export type ApplyStoreResult =
  | { ok: true; userId: string; changed: boolean }
  | { ok: false; reason: "wrong_account" | "unknown_account" };

/**
 * Write a verified store statement onto the account it belongs to.
 *
 * `expectedUserId` is set when the CLIENT submitted the receipt: the receipt's
 * account token must then be that user's own, or a signed-in person could
 * attach somebody else's leaked receipt to their account. It is null for
 * server-to-server notifications, where the account is found from the existing
 * row or, failing that, from the token.
 *
 * An older statement never overwrites a newer one. Notifications are retried
 * and arrive out of order; a stale "expired" landing after a fresh "renewed"
 * would take away a month somebody paid for.
 */
export async function applyStoreSubscription(
  state: StoreSubscriptionState,
  expectedUserId: string | null,
): Promise<ApplyStoreResult> {
  const key = storeSubscriptionKey(state.provider, state.storeId);
  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: key },
    select: { userId: true, lastEventAt: true },
  });

  let userId: string | null = null;
  if (expectedUserId) {
    const own = await prisma.user.findUnique({
      where: { id: expectedUserId },
      select: { iapAccountToken: true },
    });
    // A purchase made in our app always carries the token we handed it. One
    // without a token, or with somebody else's, was not bought by this user.
    if (!own?.iapAccountToken || state.accountToken !== own.iapAccountToken) {
      return { ok: false, reason: "wrong_account" };
    }
    if (existing && existing.userId !== expectedUserId) {
      return { ok: false, reason: "wrong_account" };
    }
    userId = expectedUserId;
  } else if (existing) {
    userId = existing.userId;
  } else if (state.accountToken) {
    userId =
      (
        await prisma.user.findUnique({
          where: { iapAccountToken: state.accountToken },
          select: { id: true },
        })
      )?.id ?? null;
  }
  if (!userId) return { ok: false, reason: "unknown_account" };

  if (existing?.lastEventAt && existing.lastEventAt > state.signedAt) {
    return { ok: true, userId, changed: false };
  }

  const fields = {
    planCode: state.planCode,
    status: state.status,
    currentPeriodEnd: state.currentPeriodEnd,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    lastEventAt: state.signedAt,
  };
  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: key },
    create: {
      userId,
      provider: state.provider,
      stripeSubscriptionId: key,
      stripeCustomerId: state.provider.toLowerCase(),
      ...fields,
    },
    update: fields,
  });
  return { ok: true, userId, changed: true };
}

/**
 * This account's token for the stores, created on first use.
 *
 * Random, not derived from the user id: Apple and Google keep it alongside the
 * purchase forever, and it should tell them nothing about who bought it. The
 * conditional update makes two concurrent first calls agree on one token.
 */
export async function iapAccountTokenFor(userId: string): Promise<string> {
  await prisma.user.updateMany({
    where: { id: userId, iapAccountToken: null },
    data: { iapAccountToken: randomUUID() },
  });
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { iapAccountToken: true },
  });
  return row.iapAccountToken!;
}

/** Where somebody manages a subscription they bought in a store. */
export const STORE_MANAGE_URL: Record<StoreProvider, string> = {
  APPLE: "https://apps.apple.com/account/subscriptions",
  GOOGLE: `https://play.google.com/store/account/subscriptions?package=${APP_BUNDLE_ID}`,
};
