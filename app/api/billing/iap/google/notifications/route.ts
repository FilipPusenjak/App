// Google Play Real-time Developer Notifications, pushed by Cloud Pub/Sub.
//
// Set up in Play Console → Monetization setup → Real-time developer
// notifications, with a Pub/Sub push subscription to
// https://www.coursechart.app/api/billing/iap/google/notifications that
// authenticates as GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT. See docs/app-store.md.
//
// A notification is only a cue: it names a purchase token, and the state is
// then fetched from Google. A forged push could at most make us look something
// up — and pushes are verified anyway.
//
// Pub/Sub retries anything but a 2xx, so a 200 goes back for every message
// that was handled or that retrying cannot help with.
import { NextResponse } from "next/server";
import { googlePlay, googleSubscriptionState } from "@/lib/billing/google";
import { applyStoreSubscription } from "@/lib/billing/iap";

export async function POST(request: Request) {
  const play = googlePlay();
  if (!play) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  if (!(await play.verifyPush(request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Unverified." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    message?: { data?: string };
  } | null;
  let event: {
    packageName?: string;
    subscriptionNotification?: { purchaseToken?: string };
  } | null = null;
  try {
    event = JSON.parse(Buffer.from(body?.message?.data ?? "", "base64").toString("utf8"));
  } catch {
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const token = event?.subscriptionNotification?.purchaseToken;
  if (!token) {
    // Test notifications, one-time products, voided purchases of things we
    // do not sell.
    return NextResponse.json({ ok: true, ignored: "not a subscription" });
  }

  // Thrown errors become a 500 on purpose: a Play API hiccup is exactly the
  // case a Pub/Sub retry fixes.
  const sub = await play.getSubscription(token);
  const state = googleSubscriptionState(token, sub, new Date());
  if (!state) return NextResponse.json({ ok: true, ignored: "product or pending" });

  const result = await applyStoreSubscription(state, null);
  if (!result.ok) {
    console.warn("[iap/google] notification for no known account");
    return NextResponse.json({ ok: true, ignored: "account" });
  }
  // The app normally acknowledges through the purchase route, but if it closed
  // before reporting the purchase, this is the only other chance before
  // Google's three-day refund.
  if (sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    await play.acknowledge(sub.lineItems![0]!.productId!, token);
  }
  return NextResponse.json({ ok: true });
}
