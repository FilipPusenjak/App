// What the counselor actually chose to deliver, and what came of it.
//
// Over a caseload and several years this becomes the one dataset the student
// app can never have: what THIS counselor's advice, given to THIS kind of
// student, actually produced. The most interesting column is `status`, and the
// most interesting value in it is DECLINED_BY_COUNSELOR — what a professional
// chose not to pass on is a judgement the model never made, and this is the
// only place it is recorded.
//
// WHAT THIS FILE MUST NEVER COMPUTE, and there is a test for each:
//
//   A counselor effectiveness metric. Scoring the professional using the tool
//   turns the tool into their supervisor, and they will stop recording honestly
//   the moment they suspect it.
//
//   A benchmark against other counselors. Same reasoning, plus a sample far too
//   small to mean anything.
//
//   A join to admissions outcomes. This is the one that looks most valuable and
//   is most dangerous: it invites cargo-culting, and across a caseload of forty
//   it would imply causation from a sample that cannot support it. The student
//   app refuses outcome joins for the same reason and this product is worse
//   placed to make them, not better.
//
// So everything below is PATTERN OBSERVATION, phrased as something noticed
// rather than something concluded.
import { prisma } from "@/lib/db";
import {
  RECOMMENDATION_TRANSITIONS,
  type RecommendationStatus,
} from "@/lib/validation/counselor";
import {
  requireCounselorAccount,
  requireCounselorPage,
  readableLinkWhere,
} from "./access";

/**
 * Change a recommendation's status, if the transition is one a counselor may make.
 *
 * Scoped through the counselor's own readable links in the WHERE clause, so a
 * recommendation belonging to another caseload is not rejected — it is not
 * found. ACCEPTED_BY_STUDENT is unreachable from here by construction: it
 * appears as no transition's target, because a counselor marking their own
 * advice as accepted would be recording an outcome that never happened in the
 * one table meant to record what actually did.
 */
export async function setRecommendationStatus(input: {
  recommendationId: string;
  next: RecommendationStatus;
  declineReason?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const account = await requireCounselorAccount();

  const existing = await prisma.counselorRecommendation.findFirst({
    where: {
      id: input.recommendationId,
      caseloadLink: readableLinkWhere(account.id),
    },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, reason: "Not found." };

  const allowed = RECOMMENDATION_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(input.next)) {
    return {
      ok: false,
      reason: `A recommendation that is ${existing.status} cannot become ${input.next}.`,
    };
  }

  await prisma.counselorRecommendation.update({
    where: { id: existing.id },
    data: {
      status: input.next,
      deliveredAt: input.next === "DELIVERED" ? new Date() : undefined,
      declineReason:
        input.next === "DECLINED_BY_COUNSELOR" ? input.declineReason ?? null : undefined,
    },
  });
  return { ok: true };
}

export type FollowThroughPattern = {
  /** What was noticed, phrased as an observation. */
  observation: string;
  /** The counts behind it, so the counselor can weigh it themselves. */
  detail: string;
  /** Below this, a pattern is noise. Surfaced so they can discount it. */
  sampleSize: number;
};

/**
 * Patterns in what this counselor's advice did, over their own caseload.
 *
 * Every figure is about RECOMMENDATIONS, never about students and never about
 * the counselor. "Six of the nine things you passed on in the last year are
 * still unresolved" is an observation about a body of advice; "your advice has
 * a 33% success rate" is a performance review, and the difference is the whole
 * design.
 *
 * Nothing is returned below MIN_SAMPLE, because a pattern drawn from three
 * recommendations is a coincidence with a percentage attached.
 */
const MIN_SAMPLE = 8;

export async function loadFollowThroughPatterns(): Promise<
  FollowThroughPattern[]
> {
  const account = await requireCounselorPage();

  const rows = await prisma.counselorRecommendation.findMany({
    where: { caseloadLink: readableLinkWhere(account.id) },
    select: {
      status: true,
      source: true,
      declineReason: true,
      caseloadLink: {
        select: { studentProfile: { select: { gradeLevel: true } } },
      },
    },
  });

  if (rows.length < MIN_SAMPLE) return [];
  const patterns: FollowThroughPattern[] = [];

  /* ── What the counselor declined to pass on ─────────────────────────────
     The most useful of the three, and the one only this product can see. If a
     professional is binning most of what is drafted, the drafting is wrong —
     and that is a fact about the app, not about them. */
  const declined = rows.filter((r) => r.status === "DECLINED_BY_COUNSELOR");
  if (declined.length > 0) {
    const share = Math.round((declined.length / rows.length) * 100);
    patterns.push({
      observation:
        share >= 50
          ? "You set aside more of the drafted options than you passed on."
          : "Some drafted options did not make it into a session.",
      detail: `${declined.length} of ${rows.length} were declined before delivery.`,
      sampleSize: rows.length,
    });
  }

  /* ── What was delivered and never taken up ──────────────────────────────
     Deliberately NOT phrased as students failing to follow through. A
     recommendation that nobody acts on is at least as likely to be the wrong
     recommendation as the wrong student. */
  const delivered = rows.filter(
    (r) => r.status === "DELIVERED" || r.status === "ACCEPTED_BY_STUDENT",
  );
  const accepted = rows.filter((r) => r.status === "ACCEPTED_BY_STUDENT");
  if (delivered.length >= MIN_SAMPLE) {
    patterns.push({
      observation:
        accepted.length * 2 < delivered.length
          ? "Most of what you delivered has not been taken up as a tracked commitment."
          : "Delivered recommendations are being taken up.",
      detail: `${accepted.length} of ${delivered.length} delivered recommendations became commitments the student accepted.`,
      sampleSize: delivered.length,
    });
  }

  /* ── Where in the school years things stall ─────────────────────────────
     Grouped by grade because that is actionable — it tells a counselor when in
     the arc to push harder — and grouping by student would be a ranking. */
  const byGrade = new Map<string, { total: number; accepted: number }>();
  for (const r of rows) {
    const grade = r.caseloadLink.studentProfile.gradeLevel ?? "Grade not set";
    const entry = byGrade.get(grade) ?? { total: 0, accepted: 0 };
    entry.total += 1;
    if (r.status === "ACCEPTED_BY_STUDENT") entry.accepted += 1;
    byGrade.set(grade, entry);
  }
  for (const [grade, counts] of byGrade) {
    if (counts.total < MIN_SAMPLE) continue;
    if (counts.accepted * 3 < counts.total) {
      patterns.push({
        observation: `Recommendations to students in ${grade} are rarely taken up.`,
        detail: `${counts.accepted} of ${counts.total} accepted.`,
        sampleSize: counts.total,
      });
    }
  }

  return patterns;
}

/**
 * What one prep proposed, with what the counselor did about each.
 *
 * Scoped through the readable-link check like everything else here.
 */
export async function loadRecommendationsForPrep(prepId: string) {
  const account = await requireCounselorPage();
  return prisma.counselorRecommendation.findMany({
    where: {
      sessionPrepId: prepId,
      caseloadLink: readableLinkWhere(account.id),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      text: true,
      basis: true,
      source: true,
      status: true,
      declineReason: true,
      deliveredAt: true,
    },
  });
}
