// In-app purchases on iOS: verifying what Apple signed.
//
// Apple hands the app a JWS for every transaction, and POSTs a JWS to us for
// every subscription event (App Store Server Notifications v2). Both are
// verified with Apple's own library against Apple's root certificate, which is
// embedded in lib/billing/apple-root-ca.ts — it is public, and fetching it at
// run time would make "is this purchase real" depend on apple.com.
//
// PRODUCTION AND SANDBOX BOTH. App Review buys with sandbox accounts against
// the production server, and so does TestFlight. A server that only accepted
// production receipts would fail review on the purchase screen. Sandbox
// purchases cost nothing, but only builds Apple distributes for testing can
// make them, so accepting them grants nothing a member of the public can reach.
import {
  Environment,
  SignedDataVerifier,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { APPLE_ROOT_CA_G3_BASE64 } from "./apple-root-ca";
import {
  APP_BUNDLE_ID,
  planCodeForStoreProduct,
  type StoreSubscriptionState,
} from "./iap";

/** What the routes need from a verifier. An interface so tests can supply one. */
export type AppleVerifier = {
  transaction(jws: string): Promise<JWSTransactionDecodedPayload>;
  renewalInfo(jws: string): Promise<JWSRenewalInfoDecodedPayload>;
  notification(jws: string): Promise<ResponseBodyV2DecodedPayload>;
};

let cached: AppleVerifier | null = null;

/**
 * The real verifier: production first, then sandbox.
 *
 * Production verification needs the app's numeric Apple ID (APPLE_APP_ID, from
 * App Store Connect → App Information). Without it only sandbox is accepted,
 * which is right for TestFlight before the app has a production listing.
 */
export function appleVerifier(): AppleVerifier {
  if (cached) return cached;
  const roots = [Buffer.from(APPLE_ROOT_CA_G3_BASE64, "base64")];
  const appAppleId = Number(process.env.APPLE_APP_ID);
  const verifiers: SignedDataVerifier[] = [];
  if (Number.isFinite(appAppleId) && appAppleId > 0) {
    verifiers.push(
      new SignedDataVerifier(roots, true, Environment.PRODUCTION, APP_BUNDLE_ID, appAppleId),
    );
  }
  verifiers.push(new SignedDataVerifier(roots, true, Environment.SANDBOX, APP_BUNDLE_ID));

  // The first verifier that accepts the signature wins. A JWS from the wrong
  // environment fails verification outright, so trying both is not a way to
  // get anything past either.
  async function first<T>(run: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const v of verifiers) {
      try {
        return await run(v);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  cached = {
    transaction: (jws) => first((v) => v.verifyAndDecodeTransaction(jws)),
    renewalInfo: (jws) => first((v) => v.verifyAndDecodeRenewalInfo(jws)),
    notification: (jws) => first((v) => v.verifyAndDecodeNotification(jws)),
  };
  return cached;
}

/**
 * A verified transaction (and, from a notification, its renewal info) as the
 * subscription row it implies. Null when it is not a product we sell.
 *
 * The status is decided from DATES Apple signed, not from the notification's
 * type: every v2 notification carries the latest transaction, and reading the
 * dates off it gives one rule for renewals, expiries, refunds and grace
 * periods instead of a switch that has to know all twenty notification types.
 */
export function appleSubscriptionState(
  tx: JWSTransactionDecodedPayload,
  renewal: JWSRenewalInfoDecodedPayload | null,
  now: Date,
): StoreSubscriptionState | null {
  const planCode = planCodeForStoreProduct("APPLE", tx.productId);
  if (!planCode || !tx.originalTransactionId) return null;

  const expires = tx.expiresDate ? new Date(tx.expiresDate) : null;
  const grace = renewal?.gracePeriodExpiresDate
    ? new Date(renewal.gracePeriodExpiresDate)
    : null;

  let status: StoreSubscriptionState["status"];
  let currentPeriodEnd = expires;
  if (tx.revocationDate) {
    // Refunded or revoked: over as of the revocation, not the period end.
    status = "canceled";
    currentPeriodEnd = new Date(tx.revocationDate);
  } else if (expires && expires > now) {
    status = "active";
  } else if (grace && grace > now) {
    // Apple is retrying a failed renewal and the developer opted into a grace
    // period: the customer keeps access until it runs out.
    status = "past_due";
    currentPeriodEnd = grace;
  } else {
    status = "canceled";
  }

  return {
    provider: "APPLE",
    storeId: tx.originalTransactionId,
    planCode,
    status,
    currentPeriodEnd,
    // AutoRenewStatus.OFF is 0: they cancelled, and it runs to its end.
    cancelAtPeriodEnd: renewal ? renewal.autoRenewStatus === 0 : false,
    signedAt: new Date(tx.signedDate ?? now.getTime()),
    accountToken: tx.appAccountToken?.toLowerCase() ?? null,
  };
}
