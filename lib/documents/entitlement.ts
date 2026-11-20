// Who may use the application document builder.
//
// THE WHOLE FEATURE IS PAID. Any active paid access unlocks it:
//
//   - a paid student plan, whatever price it was bought at (the standard Plus
//     price, or any discounted student plan added to the catalogue later) and
//     wherever it was bought (web, App Store, Google Play, or a plan granted
//     by an access code, which is a real time-limited subscription);
//   - a live, dual-consented link to a counselor or tutor whose own plan is
//     paid — their plan covers the students on it.
//
// Free users still SEE the feature, as a locked preview built from synthetic
// data (sample.ts). That is a page decision; this module is the server-side
// rule every builder route enforces before it does anything else.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { effectivePlan } from "@/lib/billing/entitlement";
import { loadSubscriptionStates } from "@/lib/billing/subscription";
import type { Plan, PlanAudience } from "@/lib/billing/plans";
import { getCurrentUser } from "@/lib/session";
import { getOrCreateProfile } from "@/lib/ownership";

export type DocumentAccess =
  | { allowed: true; via: "STUDENT_PLAN" | "PROFESSIONAL_PLAN" }
  | { allowed: false };

/** The rule itself, with every input already loaded. */
export function grantsDocumentAccess(input: {
  studentPlan: Plan | null;
  /** The effective plan of each professional the student is actively linked to. */
  professionalPlans: (Plan | null)[];
}): DocumentAccess {
  if (input.studentPlan && input.studentPlan.monthlyUsd > 0) {
    return { allowed: true, via: "STUDENT_PLAN" };
  }
  if (input.professionalPlans.some((p) => p !== null && p.monthlyUsd > 0)) {
    return { allowed: true, via: "PROFESSIONAL_PLAN" };
  }
  return { allowed: false };
}

export async function documentAccessFor(
  userId: string,
  profileId: string,
  now: Date = new Date(),
): Promise<DocumentAccess> {
  const studentPlan = effectivePlan(await loadSubscriptionStates(userId), "STUDENT", now);

  // Live links only: the same conditions readableLinkWhere enforces for the
  // professional's side, so a pending invite or a revoked grant buys nothing.
  const links = await prisma.caseloadLink.findMany({
    where: {
      studentUserId: userId,
      studentProfileId: profileId,
      status: "ACTIVE",
      endedAt: null,
      studentConsentAt: { not: null },
      guardianConsentAt: { not: null },
    },
    select: { counselorAccount: { select: { userId: true, type: true } } },
  });
  const professionalPlans = await Promise.all(
    links.map(async (l) => {
      const audience: PlanAudience =
        l.counselorAccount.type === "TEST_PREP_TUTOR" ? "TUTOR" : "COUNSELOR";
      return effectivePlan(await loadSubscriptionStates(l.counselorAccount.userId), audience, now);
    }),
  );

  return grantsDocumentAccess({ studentPlan, professionalPlans });
}

export const DOCUMENT_ACCESS_REFUSAL =
  "The application document builder is part of Plus. Nothing was generated or saved.";

/**
 * The gate at the top of every builder route. Returns the signed-in student
 * and their profile, or a response to send instead: 401 when signed out, 403
 * on the free plan. Decided here, on the server, every time — a hidden button
 * is not a permission.
 */
export async function requireDocumentAccess(): Promise<
  | { ok: true; userId: string; profileId: string }
  | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not signed in." }, { status: 401 }),
    };
  }
  const profile = await getOrCreateProfile();
  const access = await documentAccessFor(user.id, profile.id);
  if (!access.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: DOCUMENT_ACCESS_REFUSAL, code: "PLUS_REQUIRED" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, userId: user.id, profileId: profile.id };
}
