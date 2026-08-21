// POST /api/counselor/links — redeem a student's invite code.
//
// The only way a student enters a caseload. There is no lookup by email, by
// name, or by anything else a counselor could type speculatively: a code is
// something a student made and handed over, so redeeming one cannot disclose
// the existence of an account that never offered.
//
// Redemption records the STUDENT's consent, because generating the code and
// handing it over is that act. It records nothing for the guardian, so the link
// lands PENDING and the counselor sees precisely nothing until a guardian agrees
// from the student's own settings.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCounselorAccount } from "@/lib/counselor/access";
import {
  isWellFormedInviteCode,
  normalizeInviteCode,
} from "@/lib/counselor/invite";
import { linkScopeSchema } from "@/lib/validation/counselor";

const bodySchema = z.object({
  code: z.string().trim().min(1),
  /**
   * The counselor states what they need, and cannot widen it later without the
   * student seeing the change on their own access page.
   */
  scope: linkScopeSchema.default("FULL"),
});

export async function POST(request: Request) {
  const account = await requireCounselorAccount().catch(() => null);
  if (!account) {
    return NextResponse.json(
      { error: "This account is not a counselor account." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isWellFormedInviteCode(parsed.data.code)) {
    return NextResponse.json(
      { error: "That is not a valid invite code." },
      { status: 400 },
    );
  }
  const code = normalizeInviteCode(parsed.data.code);

  // The caseload limit is checked BEFORE redeeming, so a counselor at their
  // limit does not burn a student's single-use code to learn it.
  const activeCount = await prisma.caseloadLink.count({
    where: { counselorAccountId: account.id, status: "ACTIVE", endedAt: null },
  });
  if (activeCount >= account.caseloadLimit) {
    return NextResponse.json(
      {
        error: `This plan covers ${account.caseloadLimit} active students and you have ${activeCount}. Raise the plan before adding another.`,
      },
      { status: 402 },
    );
  }

  const profile = await prisma.profile.findFirst({
    where: {
      counselorInviteCode: code,
      counselorInviteExpiresAt: { gt: new Date() },
    },
    select: { id: true, userId: true },
  });
  // One message for "wrong code" and for "expired code", because two messages
  // are two different facts about whether a code ever existed.
  if (!profile) {
    return NextResponse.json(
      { error: "That code is not valid. Ask for a fresh one." },
      { status: 404 },
    );
  }

  const now = new Date();
  const existing = await prisma.caseloadLink.findUnique({
    where: {
      counselorAccountId_studentProfileId: {
        counselorAccountId: account.id,
        studentProfileId: profile.id,
      },
    },
    select: { id: true, status: true },
  });

  // Written in one transaction with the code's consumption, so a code cannot be
  // redeemed twice by two requests arriving together.
  const link = await prisma.$transaction(async (tx) => {
    const { count } = await tx.profile.updateMany({
      where: {
        id: profile.id,
        counselorInviteCode: code,
        counselorInviteExpiresAt: { gt: now },
      },
      data: { counselorInviteCode: null, counselorInviteExpiresAt: null },
    });
    // Somebody else redeemed it between the read above and here.
    if (count === 0) return null;

    if (existing) {
      // A previously ended link is revived rather than duplicated — the unique
      // constraint allows only one row per counselor per student, and a second
      // would double every triage signal and make revocation ambiguous.
      return tx.caseloadLink.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          scope: parsed.data.scope,
          invitedBy: "STUDENT",
          studentConsentAt: now,
          // Explicitly cleared. A guardian agreed to a grant that has since
          // been ended; reviving it must ask again rather than inherit.
          guardianConsentAt: null,
          endedAt: null,
          startedAt: null,
        },
      });
    }

    return tx.caseloadLink.create({
      data: {
        counselorAccountId: account.id,
        studentUserId: profile.userId,
        studentProfileId: profile.id,
        status: "PENDING",
        scope: parsed.data.scope,
        invitedBy: "STUDENT",
        studentConsentAt: now,
      },
    });
  });

  if (!link) {
    return NextResponse.json(
      { error: "That code has already been used. Ask for a fresh one." },
      { status: 409 },
    );
  }

  // Deliberately returns no student name, grade or anything else. The link is
  // PENDING, so there is nothing this counselor is entitled to see yet.
  return NextResponse.json({
    id: link.id,
    status: link.status,
    message:
      "Added, and waiting on a parent or guardian. You will see nothing about this student until they agree.",
  });
}
