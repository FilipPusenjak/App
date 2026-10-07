// Permission to send a student's data to the AI provider.
//
// Apple's App Review 5.1.2(i) asks for it by name — disclose the third-party AI
// and "obtain explicit permission before doing so" — and it is the right rule
// with or without a store: a student typing about themselves into a planning
// tool should not discover from the privacy page that it went to a model.
//
// WHOSE permission. Always the account the data belongs to, never the account
// that clicked. A counselor's prep and a tutor's briefing send a student's data
// on someone else's click; the student agreeing to share with that person is
// not the student agreeing to share with Anthropic, so those routes check the
// STUDENT's row. An account that holds its own students (a counselor running a
// caseload from one login) entered that data itself and answers for it.
//
// The check lives in each route rather than in the button, because the button
// is a convenience and the route is the guarantee — tests/integration
// pins that every route that constructs a model call refuses without it.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Machine-readable code the client branches on to show the consent panel. */
export const AI_CONSENT_REQUIRED = "AI_CONSENT_REQUIRED";

export async function hasAiConsent(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiConsentAt: true },
  });
  return Boolean(row?.aiConsentAt);
}

/** The refusal when the person running it is the person it is about. */
export function ownConsentRequired(): NextResponse {
  return NextResponse.json(
    {
      error:
        "CourseChart needs your permission before sending your profile to its AI provider.",
      code: AI_CONSENT_REQUIRED,
    },
    { status: 403 },
  );
}

/**
 * The refusal when a counselor or tutor runs it on a student's data.
 *
 * Says what the student can do, not that they "declined" — most students who
 * hit this were simply never asked, because they have not run anything
 * themselves since the question existed.
 */
export function studentConsentRequired(): NextResponse {
  return NextResponse.json(
    {
      error:
        "This student hasn't allowed AI features on their account yet. They can turn them on in their CourseChart settings.",
      code: "STUDENT_AI_CONSENT_REQUIRED",
    },
    { status: 403 },
  );
}
