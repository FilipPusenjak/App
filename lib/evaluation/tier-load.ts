// Loading everything the two tiers need, ownership-scoped.
//
// This is DB access plus the deterministic scoring layer — the one thing both
// tiers legitimately share. What each tier then does with it diverges
// completely: see context/check-in.ts and context/deep-review.ts, which share
// no code path with each other on purpose.
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
    // Same type: a check-in is measured against the last check-in, a deep
    // review against the last deep review. Mixing them would compare a
    // fortnight's delta to a month's strategy.
    prisma.evaluation.findFirst({
      where: { profileId: profile.id, type, status: "completed", isSample: false },
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
    prisma.commitment.findMany({
      where: { profileId: profile.id },
      orderBy: { createdAt: "desc" },
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
    openCommitments: commitments
      .filter((c) => ["PROPOSED", "ACCEPTED", "IN_PROGRESS"].includes(c.status))
      .map((c) => ({
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

/** All commitments, including abandoned — deep reviews read the pattern. */
export async function loadCommitmentHistory(profileId: string) {
  return prisma.commitment.findMany({
    where: { profileId },
    orderBy: { createdAt: "asc" },
    select: {
      description: true,
      status: true,
      dueDate: true,
      resolvedAt: true,
    },
  });
}
