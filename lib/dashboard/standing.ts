// "Where you stand", for an evaluation of either shape.
//
// The two shapes answer the same question with different instruments. A legacy
// evaluation gives two percentiles; a deep review gives two bands, one of which
// caps at "met" and one of which does not. The dashboard has to present both
// truthfully without pretending they are the same number.
//
// So it never converts between them. A band is not turned into a score to fit
// the old layout, and a percentile is not bucketed into a band to fit the new
// one — either would be inventing a measurement nobody made.
//
// Pure: no database, no model.
import type { StoredShape } from "@/lib/evaluation/stored-shape";

export type StandingReading =
  | {
      kind: "percentile";
      /** 0-100 against a realistic applicant pool for the named targets. */
      readiness: number | null;
      /** 0-100 against students at the same stage. */
      forYourYear: number | null;
      perSystem: { label: string; score: number }[];
    }
  | {
      kind: "band";
      /** Caps at "met" — a requirement cannot be more than satisfied. */
      requirements: string | null;
      /** No ceiling — there is no point at which the work is interesting enough. */
      differentiation: string | null;
      pace: string | null;
    }
  | { kind: "none" };

/**
 * What to show, from the stored narrative plus the computed snapshots.
 *
 * The snapshot columns are the source for a deep review's bands rather than the
 * narrative, because those were computed deterministically before the model ran
 * — reading them back out of prose would put a model's paraphrase where a
 * measurement belongs.
 */
export function readStanding(
  shape: StoredShape,
  snapshots: {
    thresholdSnapshotJson: string | null;
    differentiationSnapshotJson: string | null;
    paceStatus: string | null;
  },
): StandingReading {
  if (shape.kind === "legacy") {
    return {
      kind: "percentile",
      readiness: shape.result.overallScore,
      forYourYear: shape.result.gradeRelativeScore,
      perSystem: shape.result.systemScores.map((s) => ({
        label: s.systemLabel,
        score: s.readinessScore,
      })),
    };
  }

  if (shape.kind === "deep-review") {
    return {
      kind: "band",
      requirements: bandOf(snapshots.thresholdSnapshotJson),
      differentiation: bandOf(snapshots.differentiationSnapshotJson),
      pace: snapshots.paceStatus,
    };
  }

  // A check-in is a fortnight's delta, not a standing. Showing one as though it
  // were "where you stand" would present two weeks as the whole picture.
  return { kind: "none" };
}

function bandOf(json: string | null): string | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { band?: unknown };
    return typeof parsed.band === "string" ? parsed.band : null;
  } catch {
    return null;
  }
}

/** How a pace status reads to a student. Never "behind" as a character note. */
export const PACE_LABELS: Record<string, string> = {
  AHEAD: "Ahead of where most are at your stage",
  ON_PACE: "About where you'd expect at your stage",
  BEHIND: "Some ground to make up for your stage",
};

/**
 * What each band means, in one clause.
 *
 * Needed because a bare "emerging" or "mostly met" is a word without a scale
 * behind it, and a student reading it has no way to know whether it is good.
 */
export const BAND_MEANINGS: Record<string, string> = {
  // Threshold
  "not checked": "no researched requirements for your targets yet",
  "gaps to close": "some published requirements aren't met yet",
  "mostly met": "most published requirements are met",
  met: "every requirement we've checked is met",
  // Differentiation
  emerging: "early — most of this is still ahead of you",
  developing: "real threads forming",
  competitive: "depth that stands out",
  distinctive: "something few others will have",
};
