// Differentiation: depth, escalation, and whether the profile argues for
// anything in particular.
//
// The other half of the split. Threshold components cap at "met" because a
// requirement is a bar; these have NO ceiling, because there is no point at
// which a student has done enough interesting work. Keeping them separate is
// what stops depth in one place from silently covering an unmet prerequisite —
// a single blended readiness number does exactly that, which is why this
// product must never produce one.
//
// Measured against what the activities themselves show, never against other
// users of this app and never against a named cohort. Comparison to a peer
// group is both outside what this data can support and the thing most likely
// to harm a fourteen-year-old reading it.
//
// Pure: no database, no model.
import { RUNGS, rungIndex, type Rung } from "./rungs";

export type ActivityReading = {
  id: string;
  title: string;
  type: string;
  rung: Rung;
  months: number | null;
  /** Rung at the previous evaluation, when there was one. */
  previousRung: Rung | null;
};

export type DifferentiationSnapshot = {
  activities: ActivityReading[];
  /** Highest rung reached anywhere. Depth is what compounds. */
  topRungIndex: number;
  /** How many threads reached "sustained" or above. */
  sustainedThreadCount: number;
  /** Activities whose rung went UP since the preceding evaluation. */
  escalations: { id: string; title: string; from: Rung; to: Rung }[];
  /**
   * Threads that have not moved and have run long enough that not moving is
   * itself the observation. Not a criticism — the input to one.
   */
  stalled: { id: string; title: string; rung: Rung; months: number }[];
  band: DifferentiationBand;
};

/**
 * A band, never a score.
 *
 * "emerging" is the honest floor for a profile that has barely started, and it
 * is deliberately not a word that reads as a failing grade — a 9th grader is
 * SUPPOSED to be here, and the tone rules forbid presenting that as
 * underperformance.
 */
export const DIFFERENTIATION_BANDS = [
  "emerging",
  "developing",
  "competitive",
  "distinctive",
] as const;
export type DifferentiationBand = (typeof DIFFERENTIATION_BANDS)[number];

/** How long a thread can sit still before "stalled" is a fair description. */
const STALL_MONTHS = 9;

export function buildDifferentiationSnapshot(
  activities: ActivityReading[],
): DifferentiationSnapshot {
  const topRungIndex = activities.reduce(
    (top, a) => Math.max(top, rungIndex(a.rung)),
    0,
  );
  const sustainedIndex = rungIndex("sustained");
  const sustainedThreadCount = activities.filter(
    (a) => rungIndex(a.rung) >= sustainedIndex,
  ).length;

  const escalations = activities
    .filter((a) => a.previousRung && rungIndex(a.rung) > rungIndex(a.previousRung))
    .map((a) => ({
      id: a.id,
      title: a.title,
      from: a.previousRung!,
      to: a.rung,
    }));

  const stalled = activities
    .filter(
      (a) =>
        (a.months ?? 0) >= STALL_MONTHS &&
        rungIndex(a.rung) < rungIndex("leader") &&
        (!a.previousRung || rungIndex(a.rung) === rungIndex(a.previousRung)),
    )
    .map((a) => ({ id: a.id, title: a.title, rung: a.rung, months: a.months! }));

  return {
    activities,
    topRungIndex,
    sustainedThreadCount,
    escalations,
    stalled,
    band: differentiationBand(topRungIndex, sustainedThreadCount),
  };
}

/**
 * The band, from depth first and breadth second.
 *
 * Depth dominates on purpose: three sustained activities and nothing built is a
 * less distinctive profile than one thing taken to recognition, and a scoring
 * rule that rewarded breadth would push every student toward the same crowded
 * middle.
 */
export function differentiationBand(
  topRungIndex: number,
  sustainedThreadCount: number,
): DifferentiationBand {
  const recognized = rungIndex("recognized");
  const builder = rungIndex("builder");
  const leader = rungIndex("leader");
  const sustained = rungIndex("sustained");

  if (topRungIndex >= recognized) return "distinctive";
  if (topRungIndex >= builder && sustainedThreadCount >= 2) return "distinctive";
  if (topRungIndex >= leader) return "competitive";
  if (topRungIndex >= sustained && sustainedThreadCount >= 2) return "developing";
  if (topRungIndex >= sustained) return "developing";
  return "emerging";
}

/** The next rung up from the student's current top, for a concrete next step. */
export function nextRungTarget(snapshot: DifferentiationSnapshot): Rung | null {
  const index = snapshot.topRungIndex;
  return index >= 0 && index < RUNGS.length - 1 ? RUNGS[index + 1]! : null;
}
