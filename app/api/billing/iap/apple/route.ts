// The app reporting a purchase (or a restore) it just completed on iOS.
//
// The body is Apple's signed transaction, never a claim of ours: the product,
// the dates and the account token are all read from inside the signature. The
// route exists so the plan unlocks the moment the purchase sheet closes rather
// than whenever Apple's server notification arrives — the notification route
// keeps it current after that.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { appleSubscriptionState, appleVerifier } from "@/lib/billing/apple";
import { applyStoreSubscription } from "@/lib/billing/iap";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    signedTransaction?: unknown;
  } | null;
  const jws = typeof body?.signedTransaction === "string" ? body.signedTransaction : null;
  if (!jws) {
    return NextResponse.json({ error: "No transaction." }, { status: 400 });
  }

  let tx;
  try {
    tx = await appleVerifier().transaction(jws);
  } catch (err) {
    console.warn("[iap/apple] transaction failed verification", err);
    return NextResponse.json(
      { error: "Apple could not confirm that purchase." },
      { status: 400 },
    );
  }

  const state = appleSubscriptionState(tx, null, new Date());
  if (!state) {
    return NextResponse.json({ error: "That isn't a CourseChart plan." }, { status: 400 });
  }

  const result = await applyStoreSubscription(state, user.id);
  if (!result.ok) {
    // Bought under a different CourseChart account on this Apple ID — the
    // usual cause is signing out and into another account on one phone.
    return NextResponse.json(
      {
        error:
          "This purchase belongs to a different CourseChart account. Sign in to that account to use it.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, status: state.status });
}
