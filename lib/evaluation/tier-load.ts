// Loading everything a check-in needs, ownership-scoped.
//
// This is DB access plus the deterministic scoring layer. It was shared by two
// tiers; the Deep Review tier has since been retired, and the percentile
// evaluation — now called the Deep Review — loads its own context through
// lib/evaluation/snapshot.ts instead. The `type` parameter is kept because the
// Evaluation table still holds rows of both kinds and a check-in must be
// measured against the last CHECK_IN, never against an evaluation.
//
// Every read here resolves the profile from the session through lib/ownership.
// Nothing takes an id from a request.
import { prisma } from "@/lib/db";
import { getProfileWithRelations } from "@/lib/ownership";
import { findRequirementsForTargets } from "@/lib/requirements/lookup";
import { profileDigestSchema, type ProfileDigestSummary } from "./digest";
import {
  parseGradeLevel,
  scoreProfile,
  type ScoredProfile,
} from "@/lib/readiness/score";
import type { Rung } from "@/lib/readiness/rungs";
import type { EvaluationType } from "@/lib/validation/tiers";
import { COUNTRIES } from "@/lib/data/countries";
import { OPEN_STATUSES } from "@/lib/commitments/store";

/**
 * How many open commitments a check-in is shown.
 *
 * Smaller than the review's limit on purpose. A check-in is the cheap tier and
 * is cheap because of what it is NOT given; a list that grows with every review
 * would turn the fortnightly rhythm into a second full-price read.
 */
const CHECK_IN_COMMITMENT_LIMIT = 12;

const countryName = (code: string) =>
  COUNTRIES.find((c) => c.code === code)?.name ?? code;

export const SOURCE_DATA_VERSION = "requirements/2026-08-09";

export type LoadedTierData = {
  profileId: string;
  scored: ScoredProfile;
  digests: ProfileDigestSummary[];
  openCommitments: {
    id: string;
    description: string;
    status: string;
    dueDate: Date | null;
  }[];
  intendedMajor: string | null;
  careerGoal: string | null;
  schoolContext: string | null;
  /** Targets as named, for the rubric mapping a deep review needs. */
  targets: { name: string; country: string; countryName: string; course: string | null }[];
  /** The preceding evaluation OF THE SAME TYPE — different baselines by design. */
  preceding: {
    id: string;
    createdAt: Date;
    thresholdBand: string | null;
    differentiationBand: string | null;
    paceStatus: string | null;
    rungs: Record<string, string>;
  } | null;
  /** Edits since that preceding evaluation, for the check-in delta. */
  changeCount: number;
};

/** Bands and rungs are read back out of a stored snapshot, never recomputed. */
function readSnapshot(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadForTier(type: EvaluationType): Promise<LoadedTierData> {
  const profile = await getProfileWithRelations();

  const [preceding, digestRows, commitments] = await Promise.all([
    // Same type: a check-in is measured against the last check-in. Comparing
    // it to an evaluation would measure a fortnight's delta against a full
    // reassessment, and report the difference between two instruments as
    // movement in the student.
    //
    // No promptVersion guard, deliberately. A no-change check-in stores none at
    // all, and requiring one would drop exactly the rows the next check-in
    // measures itself against.
    prisma.evaluation.findFirst({
      where: {
        profileId: profile.id,
        type,
        status: "completed",
        isSample: false,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        thresholdSnapshotJson: true,
        differentiationSnapshotJson: true,
        paceStatus: true,
      },
    }),
    prisma.profileDigest.findMany({
      where: { profileId: profile.id },
      orderBy: { throughGrade: "asc" },
    }),
    // Only what is still open, bounded, most pressing first. This used to load
    // every commitment ever and filter in memory, which was harmless while a
    // profile had a handful — but every review adds two to four more, and an
    // unbounded list rendered into a prompt is a context budget nobody is
    // watching. Ordering by due date means a cut drops the undated tail rather
    // than whatever is newest.
    prisma.commitment.findMany({
      where: { profileId: profile.id, status: { in: [...OPEN_STATUSES] } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: CHECK_IN_COMMITMENT_LIMIT,
    }),
  ]);

  const previousThreshold = readSnapshot(preceding?.thresholdSnapshotJson ?? null);
  const previousDifferentiation = readSnapshot(
    preceding?.differentiationSnapshotJson ?? null,
  );
  const previousRungs =
    (previousDifferentiation?.rungs as Record<string, Rung> | undefined) ?? {};

  const requirements = await findRequirementsForTargets(
    profile.targetSchools.map((t) => ({
      name: t.name,
      country: t.country,
      course: t.course,
    })),
  );

  const scored = scoreProfile({
    gradeLevel: parseGradeLevel(profile.gradeLevel),
    academics: {
      gpa: profile.gpa,
      gpaScale: profile.gpaScale,
      curriculum: profile.curriculum,
      testScores: profile.testScores.map((t) => ({
        kind: t.kind,
        label: t.label,
        score: t.score,
        predicted: t.predicted,
      })),
      subjects: profile.resumeItems
        .filter((i) => i.type === "coursework")
        .map((i) => i.title),
    },
    resumeItems: profile.resumeItems.map((i) => ({
      id: i.id,
      title: i.title,
      type: i.type,
      description: i.description,
      evidenceNotes: i.evidenceNotes,
      startDate: i.startDate,
      endDate: i.endDate,
      hoursPerWeek: i.hoursPerWeek,
    })),
    requirements: requirements.map((r) => ({
      targetName: r.targetName,
      course: r.course,
      requirements: r.requirements,
      primarySourceUrl: r.primarySourceUrl,
    })),
    previousRungs,
  });

  // "Changed since" is measured on updatedAt against the preceding run, which
  // is the same signal the dashboard uses for staleness.
  const since = preceding?.createdAt ?? null;
  const changeCount = since
    ? profile.resumeItems.filter((i) => i.updatedAt > since).length +
      // TestScore has no updatedAt — createdAt is the only signal it carries,
      // so an edited score counts as a change only when it is a new row.
      profile.testScores.filter((t) => t.createdAt > since).length +
      profile.targetSchools.filter((t) => t.updatedAt > since).length +
      (profile.updatedAt > since ? 1 : 0)
    : 0;

  const digests: ProfileDigestSummary[] = [];
  for (const row of digestRows) {
    try {
      const parsed = profileDigestSchema.safeParse(JSON.parse(row.summaryJson));
      if (parsed.success) digests.push(parsed.data);
    } catch {
      // A digest that no longer validates is dropped rather than half-read.
    }
  }

  return {
    profileId: profile.id,
    scored,
    digests,
    openCommitments: commitments.map((c) => ({
      id: c.id,
      description: c.description,
      status: c.status,
      dueDate: c.dueDate,
    })),
    intendedMajor: profile.intendedMajor,
    careerGoal: profile.careerGoal,
    schoolContext: profile.schoolContext,
    targets: profile.targetSchools.map((t) => ({
      name: t.name,
      country: t.country,
      countryName: countryName(t.country),
      course: t.course,
    })),
    preceding: preceding
      ? {
          id: preceding.id,
          createdAt: preceding.createdAt,
          thresholdBand: (previousThreshold?.band as string) ?? null,
          differentiationBand: (previousDifferentiation?.band as string) ?? null,
          paceStatus: preceding.paceStatus,
          rungs: previousRungs,
        }
      : null,
    changeCount,
  };
}
