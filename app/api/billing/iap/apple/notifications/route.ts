// App Store Server Notifications v2: Apple telling us a subscription changed.
//
// Renewals, cancellations, failed payments, refunds — all arrive here, signed.
// Set this URL (https://www.coursechart.app/api/billing/iap/apple/notifications)
// as both the Production and Sandbox URL in App Store Connect → App
// Information → App Store Server Notifications, version 2.
//
// Unauthenticated by design: the signature IS the authentication. Anything
// that does not verify against Apple's root is refused with a 400, and nothing
// in the body is used before it has.
//
// A 200 tells Apple to stop retrying, so it is returned for everything that
// verified — including notifications this app has no use for (a product we do
// not sell, an account deleted since) — and withheld only when retrying could
// help.
import { NextResponse } from "next/server";
import { appleSubscriptionState, appleVerifier } from "@/lib/billing/apple";
import { applyStoreSubscription } from "@/lib/billing/iap";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    signedPayload?: unknown;
  } | null;
  const jws = typeof body?.signedPayload === "string" ? body.signedPayload : null;
  if (!jws) return NextResponse.json({ error: "No payload." }, { status: 400 });

  const verifier = appleVerifier();
  let notification;
  try {
    notification = await verifier.notification(jws);
  } catch (err) {
    console.warn("[iap/apple] notification failed verification", err);
    return NextResponse.json({ error: "Unverified." }, { status: 400 });
  }

  const signedTx = notification.data?.signedTransactionInfo;
  if (!signedTx) {
    // TEST notifications and summary types carry no transaction.
    return NextResponse.json({ ok: true, ignored: notification.notificationType });
  }

  const tx = await verifier.transaction(signedTx);
  const signedRenewal = notification.data?.signedRenewalInfo;
  const renewal = signedRenewal ? await verifier.renewalInfo(signedRenewal) : null;

  const state = appleSubscriptionState(tx, renewal, new Date());
  if (!state) return NextResponse.json({ ok: true, ignored: "product" });

  const result = await applyStoreSubscription(state, null);
  if (!result.ok) {
    // No account holds this token — deleted, or a purchase whose first
    // report never reached us and whose token is not one we issued. Nothing to
    // update, and retrying will not change that.
    console.warn("[iap/apple] notification for no known account", {
      type: notification.notificationType,
      originalTransactionId: tx.originalTransactionId,
    });
    return NextResponse.json({ ok: true, ignored: "account" });
  }
  return NextResponse.json({ ok: true });
}
