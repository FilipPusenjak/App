// Admissions rubrics as a first-class concept.
//
// US and UK admissions judge applicants on genuinely different criteria, so the
// evaluation cannot use one set of weights and reword it. A Rubric is a
// structured object — dimensions with explicit weights, plus guidance and
// cautions — that gets rendered into the prompt per target school, chosen by
// that school's country. Adding a country later means adding a file here and
// registering it; no schema change, no prompt rewrite.

/** How much a dimension actually moves the needle in this system. */
export type DimensionWeight = "critical" | "high" | "moderate" | "low";

export type RubricDimension = {
  key: string;
  label: string;
  weight: DimensionWeight;
  /** What the model should actually look for when scoring this dimension. */
  description: string;
};

/**
 * What a given point in school is actually FOR.
 *
 * Every dimension above describes a finished application — depth achieved,
 * level reached, impact evidenced. Judged against that alone, a 14-year-old
 * looks empty no matter what they do, because most of what those dimensions
 * measure is gated behind coursework, skills and relationships that take years
 * to build. That produced evaluations telling Grade 9 students their biggest
 * gap was having no admissions test score, two years before they could sit one.
 *
 * A stage says what good looks like NOW, and — just as importantly — what is
 * not yet reachable, so its absence is never counted against the student.
 */
export type RubricStage = {
  /** Stable key: "early" | "middle" | "final". */
  key: string;
  /** Human label, e.g. "Early — Grade 9-10 / Year 10-11". */
  label: string;
  /** What this stage is for. The positive model that was missing entirely. */
  purpose: string;
  /** What genuinely good evidence looks like at this stage. */
  evidence: string[];
  /**
   * Things that are GATED at this stage — they require prerequisites the
   * student cannot have yet. Their absence is not a gap and must never be
   * listed as one, nor counted against the stage-relative score.
   */
  notYetExpected: string[];
};

export type Rubric = {
  /** Stable id, also stored in prompts for traceability. */
  id: string;
  /** ISO country code this rubric serves, or "*" for the generic fallback. */
  country: string;
  /** Human label for the UI. */
  name: string;
  /** One-line characterization of the system. */
  summary: string;
  dimensions: RubricDimension[];
  /** What each point in school is for, and what is gated at it. */
  stages: RubricStage[];
  /** Rubric-specific instructions — how to weigh and interpret evidence. */
  guidance: string[];
  /** Things the model must NOT assert for this system; it should defer instead. */
  cautions: string[];
};
