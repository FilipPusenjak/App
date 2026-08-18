// Turning a loaded profile into the two snapshots, deterministically.
//
// The single entry point to the scoring layer, and the ONLY thing the two
// context builders are allowed to share. Everything downstream of here differs
// by tier: a check-in gets a digest and a delta, a deep review gets the full
// history. If they shared more than this, the tier boundary would be a gate
// rather than a genuine difference in what the model is given.
//
// Nothing here calls a model.
import {
  buildThresholdSnapshot,
  thresholdBand,
  type ResolvedRequirementLike,
  type StudentAcademics,
  type ThresholdSnapshot,
} from "./threshold";
import {
  buildDifferentiationSnapshot,
  type ActivityReading,
  type DifferentiationSnapshot,
} from "./differentiation";
import { computeRung, monthsBetween, type Rung } from "./rungs";
import { readPace, monthsUntilApplication, type PaceReading } from "./pace";

/**
 * The rubric these numbers were produced under.
 *
 * Bump when a change would make two evaluations non-comparable — a new rung, a
 * different pace curve, a changed band boundary. Never recompute stored
 * evaluations to match: history keeps what it was actually given, and the
 * timeline draws the change as a boundary rather than silently redrawing the
 * past.
 */
export const RUBRIC_VERSION = "readiness/v1";

export type ScoredProfile = {
  rubricVersion: string;
  threshold: ThresholdSnapshot;
  thresholdBand: ReturnType<typeof thresholdBand>;
  differentiation: DifferentiationSnapshot;
  pace: PaceReading;
  gradeLevel: number | null;
  monthsUntilApplication: number | null;
};

export type ResumeItemLike = {
  id: string;
  title: string;
  type: string;
  description: string | null;
  evidenceNotes: string | null;
  startDate: Date | null;
  endDate: Date | null;
  hoursPerWeek: number | null;
};

export type ScoreInput = {
  gradeLevel: number | null;
  academics: StudentAcademics;
  resumeItems: ResumeItemLike[];
  requirements: ResolvedRequirementLike[];
  /** Rungs at the preceding evaluation, keyed by item id, for escalation. */
  previousRungs?: Record<string, Rung>;
  now?: Date;
};

export function scoreProfile(input: ScoreInput): ScoredProfile {
  const now = input.now ?? new Date();

  const activities: ActivityReading[] = input.resumeItems.map((item) => {
    const months = monthsBetween(item.startDate, item.endDate, now);
    return {
      id: item.id,
      title: item.title,
      type: item.type,
      months,
      rung: computeRung({
        months,
        hoursPerWeek: item.hoursPerWeek,
        type: item.type,
        description: item.description,
        evidenceNotes: item.evidenceNotes,
      }),
      previousRung: input.previousRungs?.[item.id] ?? null,
    };
  });

  const differentiation = buildDifferentiationSnapshot(activities);
  const threshold = buildThresholdSnapshot(input.academics, input.requirements);

  return {
    rubricVersion: RUBRIC_VERSION,
    threshold,
    thresholdBand: thresholdBand(threshold),
    differentiation,
    pace: readPace({
      gradeLevel: input.gradeLevel,
      topRungIndex: differentiation.topRungIndex,
      sustainedThreadCount: differentiation.sustainedThreadCount,
    }),
    gradeLevel: input.gradeLevel,
    monthsUntilApplication: monthsUntilApplication(input.gradeLevel),
  };
}

/**
 * The grade as a number, from whatever the student typed.
 *
 * Free text by design — "Grade 11", "Year 12", "11th". Returns null rather than
 * guessing when it cannot tell, and null is handled everywhere downstream as
 * "no comparison available" rather than as a default grade.
 */
export function parseGradeLevel(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = /(\d{1,2})/.exec(raw);
  if (!match) return null;
  const n = Number(match[1]);
  // UK "Year 12/13" maps onto grades 11/12; anything outside 9-13 is not a
  // grade this app models.
  if (n >= 9 && n <= 12) return n;
  if (n === 13) return 12;
  return null;
}

/** Rungs by item id, for storing alongside an evaluation. */
export function rungMap(scored: ScoredProfile): Record<string, Rung> {
  const out: Record<string, Rung> = {};
  for (const a of scored.differentiation.activities) out[a.id] = a.rung;
  return out;
}
