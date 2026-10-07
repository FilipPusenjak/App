// Turning what Apple and Google say into a subscription row, and what such a
// row is worth. Pure — the routes and the database are in
// tests/integration/iap.test.ts.
import { createHash, X509Certificate } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appleSubscriptionState } from "@/lib/billing/apple";
import { APPLE_ROOT_CA_G3_BASE64 } from "@/lib/billing/apple-root-ca";
import { googleSubscriptionState } from "@/lib/billing/google";
import {
  STORE_EXPIRY_GRACE_MS,
  subscriptionGrantsAccess,
} from "@/lib/billing/entitlement";
import { planCodeForStoreProduct, storeSubscriptionKey } from "@/lib/billing/iap";

const NOW = new Date("2026-10-07T12:00:00Z");
const DAY = 86_400_000;
const at = (offsetDays: number) => NOW.getTime() + offsetDays * DAY;

afterEach(() => vi.unstubAllEnvs());

describe("Apple's root certificate", () => {
  it("is the one Apple publishes", () => {
    // From https://www.apple.com/certificateauthority/ — Apple Root CA - G3.
    const der = Buffer.from(APPLE_ROOT_CA_G3_BASE64, "base64");
    const fingerprint = createHash("sha256").update(der).digest("hex");
    expect(fingerprint).toBe(
      "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
    );
    expect(new X509Certificate(der).subject).toContain("Apple Root CA - G3");
  });
});

describe("which store products unlock a plan", () => {
  it("maps only our own product ids to Student Plus", () => {
    expect(planCodeForStoreProduct("APPLE", "app.coursechart.plus.monthly")).toBe("STUDENT_PLUS");
    expect(planCodeForStoreProduct("GOOGLE", "student_plus")).toBe("STUDENT_PLUS");
    expect(planCodeForStoreProduct("APPLE", "student_plus")).toBeNull();
    expect(planCodeForStoreProduct("GOOGLE", "something.else")).toBeNull();
    expect(planCodeForStoreProduct("APPLE", undefined)).toBeNull();
  });

  it("follows a configured product id", () => {
    vi.stubEnv("APPLE_PRODUCT_STUDENT_PLUS", "app.coursechart.plus2");
    expect(planCodeForStoreProduct("APPLE", "app.coursechart.plus2")).toBe("STUDENT_PLUS");
    expect(planCodeForStoreProduct("APPLE", "app.coursechart.plus.monthly")).toBeNull();
  });

  it("keys rows so the two stores and Stripe cannot collide", () => {
    expect(storeSubscriptionKey("APPLE", "2000000123")).toBe("apple_2000000123");
    const g = storeSubscriptionKey("GOOGLE", "x".repeat(300));
    expect(g).toMatch(/^google_[0-9a-f]{40}$/);
    expect(storeSubscriptionKey("GOOGLE", "x".repeat(300))).toBe(g);
  });
});

describe("an Apple transaction as a row", () => {
  const tx = {
    originalTransactionId: "2000000123",
    productId: "app.coursechart.plus.monthly",
    expiresDate: at(20),
    signedDate: at(0),
    appAccountToken: "6F9619FF-8B86-D011-B42D-00C04FC964FF",
  };

  it("is active until it expires, keyed by the original transaction", () => {
    const s = appleSubscriptionState(tx, null, NOW)!;
    expect(s).toMatchObject({
      provider: "APPLE",
      storeId: "2000000123",
      planCode: "STUDENT_PLUS",
      status: "active",
      cancelAtPeriodEnd: false,
    });
    expect(s.currentPeriodEnd?.getTime()).toBe(at(20));
    // Compared against our lowercase UUIDs.
    expect(s.accountToken).toBe("6f9619ff-8b86-d011-b42d-00c04fc964ff");
  });

  it("records a cancellation that has not run out yet", () => {
    const s = appleSubscriptionState(tx, { autoRenewStatus: 0 }, NOW)!;
    expect(s.status).toBe("active");
    expect(s.cancelAtPeriodEnd).toBe(true);
  });

  it("keeps access through a billing grace period", () => {
    const s = appleSubscriptionState(
      { ...tx, expiresDate: at(-1) },
      { gracePeriodExpiresDate: at(5) },
      NOW,
    )!;
    expect(s.status).toBe("past_due");
    expect(s.currentPeriodEnd?.getTime()).toBe(at(5));
  });

  it("ends at the refund, not the period end", () => {
    const s = appleSubscriptionState({ ...tx, revocationDate: at(-2) }, null, NOW)!;
    expect(s.status).toBe("canceled");
    expect(s.currentPeriodEnd?.getTime()).toBe(at(-2));
  });

  it("is over once it has expired", () => {
    const s = appleSubscriptionState({ ...tx, expiresDate: at(-1) }, null, NOW)!;
    expect(s.status).toBe("canceled");
  });

  it("is nothing for a product we do not sell", () => {
    expect(appleSubscriptionState({ ...tx, productId: "other" }, null, NOW)).toBeNull();
  });
});

describe("a Google Play subscription as a row", () => {
  const sub = (state: string, expiryDays = 20, extra: object = {}) => ({
    subscriptionState: state,
    externalAccountIdentifiers: { obfuscatedExternalAccountId: "tok" },
    lineItems: [
      {
        productId: "student_plus",
        expiryTime: new Date(at(expiryDays)).toISOString(),
        autoRenewingPlan: { autoRenewEnabled: true },
      },
    ],
    ...extra,
  });

  it("is active, and active-but-ending once cancelled", () => {
    expect(googleSubscriptionState("t", sub("SUBSCRIPTION_STATE_ACTIVE"), NOW)?.status).toBe("active");
    const cancelled = googleSubscriptionState(
      "t",
      {
        ...sub("SUBSCRIPTION_STATE_CANCELED"),
        lineItems: [
          { productId: "student_plus", expiryTime: new Date(at(20)).toISOString(), autoRenewingPlan: { autoRenewEnabled: false } },
        ],
      },
      NOW,
    )!;
    expect(cancelled.status).toBe("active");
    expect(cancelled.cancelAtPeriodEnd).toBe(true);
  });

  it("keeps access in grace, and none on hold or expired", () => {
    expect(googleSubscriptionState("t", sub("SUBSCRIPTION_STATE_IN_GRACE_PERIOD"), NOW)?.status).toBe("past_due");
    expect(googleSubscriptionState("t", sub("SUBSCRIPTION_STATE_ON_HOLD", -3), NOW)?.status).toBe("canceled");
    expect(googleSubscriptionState("t", sub("SUBSCRIPTION_STATE_EXPIRED", -1), NOW)?.status).toBe("canceled");
  });

  it("ends a revoked subscription now, even with time left on it", () => {
    const s = googleSubscriptionState("t", sub("SUBSCRIPTION_STATE_EXPIRED", 15), NOW)!;
    expect(s.status).toBe("canceled");
    expect(s.currentPeriodEnd?.getTime()).toBe(NOW.getTime());
  });

  it("grants nothing while payment is pending", () => {
    expect(googleSubscriptionState("t", sub("SUBSCRIPTION_STATE_PENDING"), NOW)).toBeNull();
  });

  it("carries the account token for matching", () => {
    expect(googleSubscriptionState("t", sub("SUBSCRIPTION_STATE_ACTIVE"), NOW)?.accountToken).toBe("tok");
  });
});

describe("what a store row is worth", () => {
  const row = (status: string, endOffsetMs: number | null) => ({
    planCode: "STUDENT_PLUS",
    status,
    currentPeriodEnd: endOffsetMs === null ? null : new Date(NOW.getTime() + endOffsetMs),
    cancelAtPeriodEnd: false,
    provider: "APPLE",
  });

  it("does not outlive its expiry when the 'expired' notice never arrives", () => {
    // Still "active" in the table, four days past the end Apple stated.
    expect(subscriptionGrantsAccess(row("active", -4 * DAY), NOW)).toBe(false);
  });

  it("allows a few days' slack for a renewal notice that is late", () => {
    expect(subscriptionGrantsAccess(row("active", -1 * DAY), NOW)).toBe(true);
    expect(subscriptionGrantsAccess(row("active", -STORE_EXPIRY_GRACE_MS), NOW)).toBe(false);
  });

  it("ends a refunded subscription at once, with no slack", () => {
    expect(subscriptionGrantsAccess(row("canceled", -1), NOW)).toBe(false);
  });

  it("grants nothing without an expiry", () => {
    expect(subscriptionGrantsAccess(row("active", null), NOW)).toBe(false);
  });

  it("leaves Stripe's rule alone", () => {
    expect(
      subscriptionGrantsAccess({ ...row("active", -10 * DAY), provider: "STRIPE" }, NOW),
    ).toBe(true);
    expect(
      subscriptionGrantsAccess({ ...row("active", -10 * DAY), provider: undefined }, NOW),
    ).toBe(true);
  });
});
