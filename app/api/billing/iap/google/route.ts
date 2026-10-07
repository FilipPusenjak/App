// The app reporting a purchase (or a restore) it just completed on Android.
//
// Only the purchase token is taken from the body. What it bought, until when,
// and for which account are all read back from Google — see lib/billing/google.ts.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { googlePlay, googleSubscriptionState } from "@/lib/billing/google";
import { applyStoreSubscription } from "@/lib/billing/iap";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const play = googlePlay();
  if (!play) {
    return NextResponse.json(
      { error: "Android purchases aren't connected yet." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    purchaseToken?: unknown;
  } | null;
  const token = typeof body?.purchaseToken === "string" ? body.purchaseToken : null;
  if (!token) {
    return NextResponse.json({ error: "No purchase." }, { status: 400 });
  }

  let sub;
  try {
    sub = await play.getSubscription(token);
  } catch (err) {
    console.warn("[iap/google] token lookup failed", err);
    return NextResponse.json(
      { error: "Google Play could not confirm that purchase." },
      { status: 400 },
    );
  }

  const state = googleSubscriptionState(token, sub, new Date());
  if (!state) {
    return NextResponse.json(
      { error: "That purchase isn't complete yet, or isn't a CourseChart plan." },
      { status: 400 },
    );
  }

  const result = await applyStoreSubscription(state, user.id);
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          "This purchase belongs to a different CourseChart account. Sign in to that account to use it.",
      },
      { status: 409 },
    );
  }

  // After the row is written, never before: an acknowledged purchase that we
  // then failed to record would be money taken for a plan nobody can see.
  if (sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    await play.acknowledge(sub.lineItems![0]!.productId!, token);
  }
  return NextResponse.json({ ok: true, status: state.status });
}
