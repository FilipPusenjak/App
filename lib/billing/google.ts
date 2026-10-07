// In-app purchases on Android: asking Google what a purchase token is worth.
//
// Unlike Apple, a Google purchase arrives as an opaque token, not a signed
// statement. Its meaning has to be fetched from the Play Developer API with a
// service account, so every write here — from the app or from a notification —
// re-reads the subscription from Google. A notification is only ever a cue to
// look; nothing in it is believed.
//
// ACKNOWLEDGE OR LOSE IT. Google refunds and revokes any purchase not
// acknowledged within three days, so the first time a token is seen in the
// pending state it is acknowledged here, after the row is written.
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import {
  APP_BUNDLE_ID,
  planCodeForStoreProduct,
  type StoreSubscriptionState,
} from "./iap";

/** The fields of a SubscriptionPurchaseV2 this app reads. */
export type GoogleSubscription = {
  subscriptionState?: string;
  acknowledgementState?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: {
    productId?: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }[];
};

/** What the routes need from Google. An interface so tests can supply one. */
export type GooglePlay = {
  getSubscription(purchaseToken: string): Promise<GoogleSubscription>;
  acknowledge(productId: string, purchaseToken: string): Promise<void>;
  /** Whether a Pub/Sub push request really came from our subscription. */
  verifyPush(authorizationHeader: string | null): Promise<boolean>;
};

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

let cached: GooglePlay | null = null;

/**
 * The real client. Null when GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not set —
 * the routes then answer that Android purchases are not configured, rather
 * than accepting a token they cannot check.
 */
export function googlePlay(): GooglePlay | null {
  if (cached) return cached;
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;

  const auth = new GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const pkg = encodeURIComponent(APP_BUNDLE_ID);

  async function call(path: string, init?: RequestInit) {
    const token = await auth.getAccessToken();
    const res = await fetch(`${API}/${pkg}/${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Play Developer API ${res.status}: ${await res.text()}`);
    }
    return res;
  }

  const oidc = new OAuth2Client();
  cached = {
    async getSubscription(purchaseToken) {
      const res = await call(
        `purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
      );
      return (await res.json()) as GoogleSubscription;
    },
    async acknowledge(productId, purchaseToken) {
      await call(
        `purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
        { method: "POST", body: "{}" },
      );
    },
    async verifyPush(header) {
      // Pub/Sub signs each push with an OIDC token for the service account the
      // push subscription is configured with. Fails closed when that account is
      // not configured: an unauthenticated endpoint that triggers API calls is
      // not one to leave open by accident.
      const expectedEmail = process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT?.trim();
      const audience =
        process.env.GOOGLE_PUBSUB_PUSH_AUDIENCE?.trim() ||
        "https://www.coursechart.app/api/billing/iap/google/notifications";
      const idToken = header?.startsWith("Bearer ") ? header.slice(7) : null;
      if (!expectedEmail || !idToken) return false;
      try {
        const ticket = await oidc.verifyIdToken({ idToken, audience });
        const payload = ticket.getPayload();
        return payload?.email === expectedEmail && payload.email_verified === true;
      } catch {
        return false;
      }
    },
  };
  return cached;
}

/**
 * A Play subscription as the row it implies. Null when it is not a product we
 * sell, or when it is still pending payment and so grants nothing yet.
 */
export function googleSubscriptionState(
  purchaseToken: string,
  sub: GoogleSubscription,
  now: Date,
): StoreSubscriptionState | null {
  const item = sub.lineItems?.[0];
  const planCode = planCodeForStoreProduct("GOOGLE", item?.productId);
  if (!planCode) return null;

  const state = sub.subscriptionState ?? "";
  if (state === "SUBSCRIPTION_STATE_PENDING" || state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") {
    return null;
  }

  const expiry = item?.expiryTime ? new Date(item.expiryTime) : null;
  let status: StoreSubscriptionState["status"];
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
    // Cancelled by the user but not yet expired: still theirs until expiry.
    case "SUBSCRIPTION_STATE_CANCELED":
      status = "active";
      break;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      status = "past_due";
      break;
    // ON_HOLD (payment failed past grace), PAUSED, EXPIRED (including
    // revoked and refunded): no access.
    default:
      status = "canceled";
  }

  return {
    provider: "GOOGLE",
    storeId: purchaseToken,
    planCode,
    status,
    currentPeriodEnd:
      status === "canceled" && expiry && expiry > now ? now : expiry,
    cancelAtPeriodEnd: item?.autoRenewingPlan?.autoRenewEnabled === false,
    // Google's answer carries no signing time. It is fetched fresh on every
    // write, so the moment of the fetch IS how current it is.
    signedAt: now,
    accountToken: sub.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
  };
}
