// Where a student sits against the modeled curve for their own grade.
//
// This is the answer to "is my readiness score low because I am behind, or
// because I am fourteen?" — a distinction the product gets wrong by default.
// A 9th grader's overall readiness is structurally low because most of their
// profile has not happened yet. That is arithmetic, and presenting it as
// underperformance is the single easiest way for this app to do harm.
//
// So pace is measured against what is REACHABLE by a given grade, never against
// other users of this app and never against a named cohort.
//
// Pure: no database, no model.

export const PACE_STATUSES = ["AHEAD", "ON_PACE", "BEHIND"] as const;
export type PaceStatus = (typeof PACE_STATUSES)[number];

/**
 * The depth a student can plausibly have reached by the END of each grade.
 *
 * Expressed as a rung index (see rungs.ts) on their strongest thread, because
 * depth in one place is what compounds. These are modeling assumptions, not
 * published facts — the app never states them to a student as though they were.
 *
 * Grade 9 is 1 ("participant") on purpose: a 9th grader who has joined things
 * and kept at them is exactly on track, and any model that says otherwise is
 * manufacturing a deficit.
 */
const EXPECTED_TOP_RUNG_BY_GRADE: Record<number, number> = {
  9: 1,
  10: 2,
  11: 4,
  12: 5,
};

/** The number of distinct sustained threads that is normal by each grade. */
const EXPECTED_SUSTAINED_THREADS_BY_GRADE: Record<number, number> = {
  9: 1,
  10: 2,
  11: 2,
  12: 3,
};

export type PaceInput = {
  /** 9-12. Null when the student has not said, which is not their failure. */
  gradeLevel: number | null;
  /** Highest rung index reached on any single activity. */
  topRungIndex: number;
  /** How many activities have reached "sustained" or above. */
  sustainedThreadCount: number;
};

export type PaceReading = {
  status: PaceStatus;
  /** What this is measured against, for the model to explain rather than assert. */
  expectedTopRungIndex: number;
  expectedSustainedThreads: number;
  /**
   * True when there is no grade to compare against. The caller must not treat
   * ON_PACE here as a finding — it is the absence of one.
   */
  unknownGrade: boolean;
};

export function readPace(input: PaceInput): PaceReading {
  const grade = input.gradeLevel;
  if (grade == null || !(grade in EXPECTED_TOP_RUNG_BY_GRADE)) {
    return {
      status: "ON_PACE",
      expectedTopRungIndex: 0,
      expectedSustainedThreads: 0,
      unknownGrade: true,
    };
  }

  const expectedTopRungIndex = EXPECTED_TOP_RUNG_BY_GRADE[grade]!;
  const expectedSustainedThreads = EXPECTED_SUSTAINED_THREADS_BY_GRADE[grade]!;

  // Depth counts for more than breadth, so the top rung decides and the thread
  // count can only pull a borderline reading down.
  const depthDelta = input.topRungIndex - expectedTopRungIndex;
  const meetsBreadth = input.sustainedThreadCount >= expectedSustainedThreads;

  let status: PaceStatus;
  if (depthDelta >= 1 && meetsBreadth) status = "AHEAD";
  else if (depthDelta <= -2) status = "BEHIND";
  else if (depthDelta <= -1 && !meetsBreadth) status = "BEHIND";
  else status = "ON_PACE";

  return {
    status,
    expectedTopRungIndex,
    expectedSustainedThreads,
    unknownGrade: false,
  };
}

/**
 * Months until applications are submitted, from the grade the student is in or
 * has just completed.
 *
 * Rough by design — it drives feasibility categories ("can this be finished in
 * time?"), not a countdown. A precise date would imply a deadline this app does
 * not know and should not manufacture urgency about.
 */
export function monthsUntilApplication(gradeLevel: number | null): number | null {
  if (gradeLevel == null) return null;
  // Applications go in during the autumn of grade 12: roughly 12 months per
  // remaining year, plus the couple of months into the final autumn.
  const yearsLeft = 12 - gradeLevel;
  if (yearsLeft < 0) return 0;
  return yearsLeft * 12 + 2;
}

export const FEASIBILITY = ["FEASIBLE", "TIGHT", "TOO_LATE"] as const;
export type Feasibility = (typeof FEASIBILITY)[number];

/**
 * Can a piece of advice actually be completed in the time left?
 *
 * A hard filter, not a tone adjustment. Advice for a 10th grader and a rising
 * senior are different CATEGORIES of advice, and softening the wording of an
 * impossible suggestion still leaves a student being told to start a two-year
 * commitment they cannot finish.
 */
export function feasibility(
  monthsNeeded: number,
  monthsLeft: number | null,
): Feasibility {
  if (monthsLeft == null) return "TIGHT";
  // 0.75 leaves real headroom without being so cautious that long-horizon work
  // stops being offered to the students who actually have the runway for it.
  // At 0.6 a two-year commitment starting in 9th grade came back TIGHT, which
  // would push early-years students away from precisely the sustained work
  // that compounds — the opposite of what this filter is for.
  if (monthsNeeded <= monthsLeft * 0.75) return "FEASIBLE";
  if (monthsNeeded <= monthsLeft) return "TIGHT";
  return "TOO_LATE";
}
