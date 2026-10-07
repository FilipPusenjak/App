// The account token the app sends with an in-app purchase.
//
// Apple calls it appAccountToken and Google obfuscatedExternalAccountId; both
// sign it back inside the receipt, which is how a purchase is tied to the
// account that made it. See User.iapAccountToken.
//
// POST rather than GET: the first call creates the token, and a GET that
// writes is a GET a prefetcher can trigger.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { iapAccountTokenFor } from "@/lib/billing/iap";

export async function POST() {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json({ token: await iapAccountTokenFor(user.id) });
}
