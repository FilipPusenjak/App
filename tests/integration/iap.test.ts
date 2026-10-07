// In-app purchases through the real routes and a real database.
//
// Apple's signature check and Google's API are stubbed — they need the stores
// — and everything after them is real: tying a receipt to an account, writing
// the row, ordering late notifications, and what the account is then on.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { effectivePlanFor } from "@/lib/billing/subscription";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("iap");
const d = hasTestDb ? describe : describe.skip;

const session = { userId: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => session.userId,
  getCurrentUser: async () => ({ id: session.userId, email: "x@example.test" }),
}));

/**
 * The stub "verifies" a JWS by parsing it as JSON, and refuses anything
 * starting with "forged". Enough to drive the routes; the real signature check
 * is Apple's library.
 */
vi.mock("@/lib/billing/apple", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/apple")>();
  const decode = async (jws: string) => {
    if (jws.startsWith("forged")) throw new Error("bad signature");
    return JSON.parse(jws);
  };
  return {
    ...actual,
    appleVerifier: () => ({
      transaction: decode,
      renewalInfo: decode,
      notification: decode,
    }),
  };
});

const play = {
  subs: new Map<string, unknown>(),
  acknowledged: [] as string[],
  pushOk: true,
};
vi.mock("@/lib/billing/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/google")>();
  return {
    ...actual,
    googlePlay: () => ({
      getSubscription: async (token: string) => {
        const s = play.subs.get(token);
        if (!s) throw new Error("404");
        return s;
      },
      acknowledge: async (_product: string, token: string) => {
        play.acknowledged.push(token);
      },
      verifyPush: async () => play.pushOk,
    }),
  };
});

const tokenRoute = (await import("@/app/api/billing/iap/token/route")).POST;
const appleRoute = (await import("@/app/api/billing/iap/apple/route")).POST;
const appleNotify = (await import("@/app/api/billing/iap/apple/notifications/route")).POST;
const googleRoute = (await import("@/app/api/billing/iap/google/route")).POST;
const googleNotify = (await import("@/app/api/billing/iap/google/notifications/route")).POST;

const DAY = 86_400_000;
let seq = 0;
const uniq = () => `u${seq++}`;

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function signedInWithToken() {
  const made = await createUserWithProfile(runTag, uniq());
  session.userId = made.user.id;
  const { token } = await (await tokenRoute()).json();
  return { ...made, token: token as string };
}

function appleTx(token: string, over: Record<string, unknown> = {}) {
  return JSON.stringify({
    originalTransactionId: `otx-${uniq()}`,
    productId: "app.coursechart.plus.monthly",
    expiresDate: Date.now() + 30 * DAY,
    signedDate: Date.now(),
    appAccountToken: token,
    ...over,
  });
}

d("in-app purchases", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
    play.subs.clear();
    play.acknowledged = [];
    play.pushOk = true;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("gives an account one stable token for the stores", async () => {
    const { user, token } = await signedInWithToken();
    const again = await (await tokenRoute()).json();
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(again.token).toBe(token);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).iapAccountToken).toBe(token);
  });

  it("unlocks Plus the moment an iOS purchase is reported", async () => {
    const { user, token } = await signedInWithToken();
    expect((await effectivePlanFor(user.id, "STUDENT"))?.code).toBe("STUDENT_FREE");

    const res = await appleRoute(json("/api/billing/iap/apple", { signedTransaction: appleTx(token) }));
    expect(res.status).toBe(200);

    expect((await effectivePlanFor(user.id, "STUDENT"))?.code).toBe("STUDENT_PLUS");
    const row = await prisma.subscription.findFirstOrThrow({ where: { userId: user.id } });
    expect(row).toMatchObject({ provider: "APPLE", stripeCustomerId: "apple", status: "active" });
  });

  it("refuses a receipt bought under somebody else's account", async () => {
    const owner = await signedInWithToken();
    const ownerTx = appleTx(owner.token);
    await signedInWithToken(); // now signed in as a second person

    const res = await appleRoute(json("/api/billing/iap/apple", { signedTransaction: ownerTx }));
    expect(res.status).toBe(409);
    expect(await prisma.subscription.count({ where: { userId: session.userId } })).toBe(0);
  });

  it("refuses a purchase with no account token at all", async () => {
    await signedInWithToken();
    const tx = appleTx("unused", { appAccountToken: undefined });
    const res = await appleRoute(json("/api/billing/iap/apple", { signedTransaction: tx }));
    expect(res.status).toBe(409);
  });

  it("refuses what Apple did not sign", async () => {
    await signedInWithToken();
    const res = await appleRoute(json("/api/billing/iap/apple", { signedTransaction: "forged.jws" }));
    expect(res.status).toBe(400);
    expect(await prisma.subscription.count({ where: { userId: session.userId } })).toBe(0);
  });

  it("keeps the row current from Apple's notifications, ignoring a stale one", async () => {
    const { user, token } = await signedInWithToken();
    const otx = `otx-${uniq()}`;
    await appleRoute(
      json("/api/billing/iap/apple", {
        signedTransaction: appleTx(token, { originalTransactionId: otx, signedDate: Date.now() - 2 * DAY }),
      }),
    );

    // A refund, signed now.
    const refund = {
      notificationType: "REFUND",
      data: {
        signedTransactionInfo: appleTx(token, {
          originalTransactionId: otx,
          revocationDate: Date.now() - 1000,
          signedDate: Date.now(),
        }),
      },
    };
    expect((await appleNotify(json("/n", { signedPayload: JSON.stringify(refund) }))).status).toBe(200);
    expect((await effectivePlanFor(user.id, "STUDENT"))?.code).toBe("STUDENT_FREE");

    // An older "renewed" arriving after it must not undo the refund.
    const stale = {
      notificationType: "DID_RENEW",
      data: {
        signedTransactionInfo: appleTx(token, {
          originalTransactionId: otx,
          signedDate: Date.now() - DAY,
        }),
      },
    };
    await appleNotify(json("/n", { signedPayload: JSON.stringify(stale) }));
    expect((await effectivePlanFor(user.id, "STUDENT"))?.code).toBe("STUDENT_FREE");
  });

  it("finds the account from the token when the app never reported the purchase", async () => {
    const { user, token } = await signedInWithToken();
    const n = { notificationType: "SUBSCRIBED", data: { signedTransactionInfo: appleTx(token) } };
    session.userId = ""; // a server-to-server call has no session
    expect((await appleNotify(json("/n", { signedPayload: JSON.stringify(n) }))).status).toBe(200);
    expect((await effectivePlanFor(user.id, "STUDENT"))?.code).toBe("STUDENT_PLUS");
  });

  it("answers 200 to a verified notification it cannot place, so Apple stops retrying", async () => {
    const n = { notificationType: "SUBSCRIBED", data: { signedTransactionInfo: appleTx("no-such-token") } };
    const res = await appleNotify(json("/n", { signedPayload: JSON.stringify(n) }));
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe("account");
  });

  it("unlocks Plus from a Google purchase, and acknowledges it only after recording it", async () => {
    const { user, token } = await signedInWithToken();
    play.subs.set("gtok-1", {
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      externalAccountIdentifiers: { obfuscatedExternalAccountId: token },
      lineItems: [{ productId: "student_plus", expiryTime: new Date(Date.now() + 30 * DAY).toISOString() }],
    });

    const res = await googleRoute(json("/api/billing/iap/google", { purchaseToken: "gtok-1" }));
    expect(res.status).toBe(200);
    expect(play.acknowledged).toEqual(["gtok-1"]);
    expect((await effectivePlanFor(user.id, "STUDENT"))?.code).toBe("STUDENT_PLUS");
  });

  it("neither records nor acknowledges a Google purchase for another account", async () => {
    const owner = await signedInWithToken();
    play.subs.set("gtok-2", {
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      externalAccountIdentifiers: { obfuscatedExternalAccountId: owner.token },
      lineItems: [{ productId: "student_plus", expiryTime: new Date(Date.now() + 30 * DAY).toISOString() }],
    });
    await signedInWithToken();

    const res = await googleRoute(json("/api/billing/iap/google", { purchaseToken: "gtok-2" }));
    expect(res.status).toBe(409);
    expect(play.acknowledged).toEqual([]);
  });

  it("re-reads Google on a notification, and refuses an unverified push", async () => {
    const { user, token } = await signedInWithToken();
    play.subs.set("gtok-3", {
      subscriptionState: "SUBSCRIPTION_STATE_EXPIRED",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      externalAccountIdentifiers: { obfuscatedExternalAccountId: token },
      lineItems: [{ productId: "student_plus", expiryTime: new Date(Date.now() - DAY).toISOString() }],
    });
    const push = (data: object) =>
      json("/n", { message: { data: Buffer.from(JSON.stringify(data)).toString("base64") } });
    const event = { subscriptionNotification: { purchaseToken: "gtok-3", notificationType: 13 } };

    play.pushOk = false;
    expect((await googleNotify(push(event))).status).toBe(401);
    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(0);

    play.pushOk = true;
    expect((await googleNotify(push(event))).status).toBe(200);
    const row = await prisma.subscription.findFirstOrThrow({ where: { userId: user.id } });
    expect(row).toMatchObject({ provider: "GOOGLE", status: "canceled" });
    expect((await effectivePlanFor(user.id, "STUDENT"))?.code).toBe("STUDENT_FREE");
  });
});
