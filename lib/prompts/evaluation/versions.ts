// Which prompt version changed the meaning of which score.
//
// Every run is anchored to the previous one so scores cannot drift on
// unchanged input. That anchor has to be released when a score is REDEFINED,
// or the old calibration is carried forward forever — but releasing it wholesale
// is its own bug: v9 redefined only gradeRelativeScore, and dropping every
// anchor along with it let a student's readiness score fall eight points with
// no change to their profile and no change to what that number means. Drift
// with a reason attached is a correction; drift without one is noise, and the
// history view exists to tell those apart.
//
// So the release is per-score, and that requires knowing what each version
// actually changed.
export const SCORE_KEYS = [
  "overallScore",
  "gradeRelativeScore",
  "fitScore",
] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

/** Student-facing names, for a message that has to be read by one. */
export const SCORE_LABELS: Record<ScoreKey, string> = {
  overallScore: "overallScore (readiness)",
  gradeRelativeScore: "gradeRelativeScore (for your year)",
  fitScore: "fitScore (per school)",
};

type VersionEntry = {
  version: string;
  /** Scores whose DEFINITION this version changed. Not "scores it mentions". */
  redefined: ScoreKey[];
  why: string;
};

/**
 * In order, oldest first. A version that changes wording without changing what
 * a number MEANS redefines nothing — the anchor should hold across it.
 */
export const VERSION_HISTORY: VersionEntry[] = [
  { version: "evaluation/v1", redefined: [], why: "First version." },
  { version: "evaluation/v2", redefined: [], why: "Per-item assessments and actions; no score meaning changed." },
  {
    version: "evaluation/v3",
    redefined: ["gradeRelativeScore"],
    why: "Introduced gradeRelativeScore.",
  },
  {
    version: "evaluation/v4",
    redefined: ["overallScore", "gradeRelativeScore"],
    why: "Qualitative bands and cross-run anchoring changed what both headline numbers meant.",
  },
  {
    version: "evaluation/v5",
    redefined: ["overallScore", "gradeRelativeScore"],
    why: "Both headline scores became percentiles.",
  },
  {
    version: "evaluation/v6",
    redefined: ["overallScore", "fitScore"],
    why: "fitScore defined against a selectivity tier; overallScore's pool anchored to the most selective targets.",
  },
  {
    version: "evaluation/v7",
    redefined: ["gradeRelativeScore"],
    why: "Comparison pool became the ordinary university-bound cohort.",
  },
  {
    version: "evaluation/v8",
    redefined: ["gradeRelativeScore"],
    why: "Concrete bands replaced a single sentence of guidance.",
  },
  {
    version: "evaluation/v9",
    redefined: ["gradeRelativeScore"],
    why: "Bands read at the student's stage, so the upper ones are reachable in an early year.",
  },
  {
    version: "evaluation/v10",
    redefined: [],
    why: "Carries unchanged item assessments forward to cut cost. No score means anything different, so nothing is released.",
  },
];

/**
 * Which scores have been redefined since the given version was current.
 *
 * An unrecognised or missing version means an unknown scale, and an unknown
 * scale is not this one — every score is released rather than pinned to a
 * number whose provenance cannot be established.
 */
export function scoresRedefinedSince(previousVersion: string | null | undefined): ScoreKey[] {
  if (!previousVersion) return [...SCORE_KEYS];

  const index = VERSION_HISTORY.findIndex((v) => v.version === previousVersion);
  if (index === -1) return [...SCORE_KEYS];

  const changed = new Set<ScoreKey>();
  for (const entry of VERSION_HISTORY.slice(index + 1)) {
    for (const key of entry.redefined) changed.add(key);
  }
  return SCORE_KEYS.filter((key) => changed.has(key));
}
