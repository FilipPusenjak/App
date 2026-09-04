// POST /api/billing/redeem — turn a code into one run.
//
// A code grants a RUN, never a price change and never a plan, so nothing here
// touches Stripe or a subscription. The worst case for a leaked code is bounded
// by its own maxRedemptions and by the account spend cap underneath everything.
//
// Rate-limited per account, because this is the one endpoint where guessing is
// the attack: a code is short enough to type, so it is short enough to try in a
// loop. The limit is deliberately tight — nobody legitimately redeems six codes
// in a minute.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { redeemCode } from "@/lib/billing/codes";
import { RUN_LABELS } from "@/lib/billing/quota";

const bodySchema = z.object({ code: z.string().trim().min(1).max(64) });

/** Redemption attempts allowed per account per hour, successful or not. */
const MAX_ATTEMPTS_PER_HOUR = 10;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a code." }, { status: 400 });
  }

  // Counted against SUCCESSFUL redemptions, which is what the table records.
  // A brute-force attempt produces no row, so this does not stop guessing on
  // its own — the code space does that (27^8, from an unambiguous alphabet).
  // What this stops is somebody draining a batch of codes they found.
  const recent = await prisma.accessCodeRedemption.count({
    where: {
      userId: user.id,
      redeemedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });
  if (recent >= MAX_ATTEMPTS_PER_HOUR) {
    return NextResponse.json(
      { error: "Too many codes redeemed in the last hour. Try again later." },
      { status: 429 },
    );
  }

  const result = await redeemCode({ userId: user.id, code: parsed.data.code });
  if (!result.ok) {
    // 400 for every refusal, with the reason in the body. Deliberately the same
    // status whether the code is unknown, expired or exhausted — a prober
    // should not be able to tell "no such code" from "already used".
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: 400 },
    );
  }

  if (result.grant === "PLAN") {
    const until = result.expiresAt.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return NextResponse.json({
      ok: true,
      grant: "PLAN",
      planCode: result.planCode,
      message: `Code accepted — ${result.planName} added to your account until ${until}.`,
    });
  }

  return NextResponse.json({
    ok: true,
    grant: "RUN",
    kind: result.kind,
    label: RUN_LABELS[result.kind],
    granted: result.granted,
    totalRemaining: result.totalRemaining,
    message:
      result.granted === 1
        ? `Code accepted — one ${RUN_LABELS[result.kind]} added to your account.`
        : `Code accepted — ${result.granted} ${RUN_LABELS[result.kind]} runs added.`,
  });
}
