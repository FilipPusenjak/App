// Where the composite is cheapest to move.
//
// A student at 34 English / 24 Math on the ACT should be told, in those words,
// that Math is where the composite moves. That is the whole job here, and it is
// arithmetic — headroom against what the composite rule does with it.
//
// pointsPerUnitEffort IS A HEURISTIC AND MUST BE LABELLED AS ONE EVERYWHERE IT
// IS RENDERED. It models where room exists; it is NOT evidence about how fast
// this particular student learns, and there is no honest way to get that from a
// score history. Presenting it as a measurement would be inventing a fact about
// a person out of a fact about a scale — which is the same error as predicting
// a score, wearing a decimal point.
import type {
  CompositeRule,
  TestSectionSchema,
} from "@/lib/validation/testprep";
import type { SectionScores } from "./composite";

export type Allocation = {
  sectionName: string;
  currentScore: number | null;
  /** Distance from current to the section maximum. Where the room is. */
  headroom: number;
  /**
   * Composite points gained per section point gained, times remaining room.
   * A heuristic. See the file header.
   */
  pointsPerUnitEffort: number;
  recommendedFocus: boolean;
};

/**
 * How much the composite moves per single point in one section.
 *
 * The reason this is not always 1: an averaging test divides. One ACT Math
 * point is a quarter of a composite point, which is why ACT students are told
 * to move their weakest section rather than polish their strongest — the
 * arithmetic rewards it, and a tool that reported "1 point" for both would hide
 * that.
 */
export function compositeLeveragePerPoint(
  rule: CompositeRule,
  sectionCount: number,
): number {
  switch (rule) {
    case "SUM":
      return 1;
    case "AVERAGE":
      return sectionCount > 0 ? 1 / sectionCount : 0;
    case "HIGHEST_SECTION":
      // Only the best section moves the reported figure at all.
      return 1;
    case "NONE":
      return 0;
  }
}

/**
 * Section allocation for one score history.
 *
 * `recommendedFocus` marks the section where the most composite is available,
 * and marks NOTHING when there is no room anywhere — an empty recommendation is
 * the honest output for a maxed student, and inventing a focus for them is how
 * a tool talks someone into another month of sessions.
 */
export function allocateSections(input: {
  current: SectionScores;
  schema: TestSectionSchema;
  rule: CompositeRule;
}): Allocation[] {
  const { current, schema, rule } = input;
  const leverage = compositeLeveragePerPoint(rule, schema.sections.length);

  const allocations: Allocation[] = schema.sections.map((section) => {
    const score = current[section.name];
    const currentScore = typeof score === "number" && !Number.isNaN(score) ? score : null;
    const headroom = currentScore === null ? section.max - section.min : Math.max(0, section.max - currentScore);

    return {
      sectionName: section.name,
      currentScore,
      headroom,
      // Room times what a point in this section is worth to the composite.
      // Rounded to two places so a UI never has to decide how to print it.
      pointsPerUnitEffort: Math.round(headroom * leverage * 100) / 100,
      recommendedFocus: false,
    };
  });

  // The section with the most available composite. Ties break on the lowest
  // current score — a tie means equal room, and the weaker section is the one a
  // tutor can actually move.
  let best: Allocation | null = null;
  for (const a of allocations) {
    if (a.headroom <= 0) continue;
    if (best === null || a.pointsPerUnitEffort > best.pointsPerUnitEffort) {
      best = a;
      continue;
    }
    if (a.pointsPerUnitEffort === best.pointsPerUnitEffort) {
      const aScore = a.currentScore ?? Number.POSITIVE_INFINITY;
      const bScore = best.currentScore ?? Number.POSITIVE_INFINITY;
      if (aScore < bScore) best = a;
    }
  }
  if (best) best.recommendedFocus = true;

  return allocations;
}

export type RetakeGuidance = {
  /**
   * Whether "sit again and aim at ONE section" is honest advice here.
   *
   * False whenever the school setting the target does not superscore. See the
   * function below — this is the flag every caller must consult before naming a
   * section as a retake goal.
   */
  singleSection: boolean;
  /** The section to aim a retake at, or null when no such advice is honest. */
  focusSection: string | null;
  message: string;
};

/**
 * What to say about sitting the test again.
 *
 * A SUPERSCORE-FALSE SCHOOL NEVER GETS SINGLE-SECTION RETAKE ADVICE, and that
 * is the entire reason this function exists separately from allocateSections.
 *
 * The arithmetic: a superscoring school composes the best Math with the best
 * English from different sittings, so lifting one section is a real, retained
 * gain and "spend the next month on Math" is sound. A school that does not
 * superscore reads ONE sitting whole. A student who lifts Math by 60 and drops
 * English by 70 in the same sitting has gone backwards at that school — and a
 * student told to spend a month on Math alone is being set up to do exactly
 * that, because the sections they stopped practising are the ones that slip.
 *
 * So headroom is still reported (it is a fact about the scale, true either
 * way), but the recommendation changes shape: at a non-superscoring school the
 * only honest goal is a better sitting, all sections held.
 */
export function retakeGuidance(input: {
  allocations: Allocation[];
  bindingSuperscores: boolean;
  bindingSchoolName: string | null;
}): RetakeGuidance {
  const focus = input.allocations.find((a) => a.recommendedFocus);

  if (!focus) {
    return {
      singleSection: false,
      focusSection: null,
      message: "No section has room left to move — the composite cannot go higher.",
    };
  }

  if (!input.bindingSuperscores) {
    const school = input.bindingSchoolName ?? "The school setting this target";
    return {
      singleSection: false,
      focusSection: null,
      message: `${school} does not superscore, so it reads one sitting whole. A retake only helps if every section holds — a gain in one section and a slip in another nets out to nothing there. ${focus.sectionName} has the most room, but it is not a goal a retake can be aimed at on its own.`,
    };
  }

  return {
    singleSection: true,
    focusSection: focus.sectionName,
    message: `${input.bindingSchoolName ?? "This school"} superscores, so a better ${focus.sectionName} is kept even if the rest of the sitting is no better than before. That makes ${focus.sectionName} the one thing a retake needs to move.`,
  };
}
