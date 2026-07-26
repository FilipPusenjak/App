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
  /** Rubric-specific instructions — how to weigh and interpret evidence. */
  guidance: string[];
  /** Things the model must NOT assert for this system; it should defer instead. */
  cautions: string[];
};
