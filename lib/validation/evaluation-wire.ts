// The shape the MODEL emits, as opposed to the shape the app stores.
//
// These were the same object until the API started rejecting the request:
//
//   400 — "The compiled grammar is too large, which would cause performance
//   issues. Simplify your tool schemas or reduce the number of strict tools."
//
// Nothing about the evaluation grew unreasonable — v5 added a stage reading,
// gap timing and a second value per item, taking the result object from 15
// top-level properties to 16. The cost of a property is not linear, though: an
// object whose properties may arrive in any order is compiled into a grammar
// that tracks which ones have already been emitted, so the state count grows
// with 2^(number of properties). Sixteen siblings is roughly sixty-five
// thousand; the same sixteen fields split across two objects of ten and seven
// is barely two thousand. Nesting is the whole fix.
//
// So the seven fields that make up the headline reading are grouped into one
// `overview` object on the wire and flattened straight back out again. The
// stored JSON, the database, the UI and every older evaluation are completely
// unaffected — fromWireResult() returns exactly the shape
// evaluationResultSchema has always described, and the route still validates
// against it before storing.
//
// The grouping is derived from the strict schema rather than restated, so the
// two cannot drift: add a field to evaluationResultSchema and it appears on the
// wire automatically.
import { z } from "zod";
import {
  evaluationResultSchema,
  itemAssessmentSchema,
  schoolFitSchema,
  type EvaluationResult,
} from "./evaluation";
import {
  KEY_RISKS_CEILING,
  KEY_RISKS_TARGET,
  SECTION_CEILING_CHARS,
  tooLongMessage,
} from "./evaluation-limits";

/**
 * The headline reading: the numbers, what they mean, and how they moved.
 *
 * These belong together for the student as well as for the grammar — it is the
 * block at the top of the results page. Grouping them also puts them LAST in
 * the emitted JSON, after the per-item and per-school analysis, so the scores
 * are written once the model has already done the work they summarize.
 */
const OVERVIEW_KEYS = {
  headline: true,
  summary: true,
  overallScore: true,
  gradeRelativeScore: true,
  gradeContext: true,
  changeSinceLast: true,
  narrativeCoherence: true,
} as const;

export const evaluationOverviewSchema =
  evaluationResultSchema.pick(OVERVIEW_KEYS);

/**
 * The prose analysis: everything that is a list of findings rather than a
 * score or a per-target judgment.
 *
 * Grouped for the same reason as overview. Adding one field to schoolFits in
 * v6 took the estimated grammar from ~2,100 — a size that demonstrably
 * compiled — to ~2,600, which is exactly the kind of creep that caused the
 * outage in the first place. Pulling these five out drops the top level to six
 * siblings and leaves the whole schema at roughly half of what was known to
 * work, so there is real headroom rather than a number that merely looks
 * smaller than the last failure.
 */
const ANALYSIS_KEYS = {
  strengths: true,
  weaknesses: true,
  actions: true,
  gaps: true,
  verifyThese: true,
  // Inside analysis rather than at the top level, and that placement is a
  // grammar decision, not a taxonomy one. Top-level siblings cost 2^n states;
  // a seventh would double the whole schema's state count, which is the creep
  // that caused the 400 this file exists because of. Nested here it costs one
  // property on a small object and leaves the top level at six.
  //
  // It also happens to be right on the merits: a commitment is a finding the
  // student is asked to act on, which is what everything else in this group is.
  proposedCommitments: true,
} as const;

export const evaluationAnalysisSchema =
  evaluationResultSchema.pick(ANALYSIS_KEYS);

export const evaluationWireSchema = evaluationResultSchema
  .omit({ ...OVERVIEW_KEYS, ...ANALYSIS_KEYS })
  .extend({
    analysis: evaluationAnalysisSchema,
    overview: evaluationOverviewSchema,
  });

export type EvaluationWireResult = z.infer<typeof evaluationWireSchema>;

/**
 * The wire schema WITH the length ceilings on the sections that multiply.
 *
 * This is what a response is validated against. It is deliberately NOT what
 * is handed to the API as the output grammar — that stays evaluationWireSchema,
 * unchanged, for two reasons:
 *
 *   - The grammar has a size budget (tests/unit/structured-output.test.ts) and
 *     proven behaviour on every review to date. Adding constraints changes what
 *     the API does on every call, to enforce something the prompt already asks
 *     for.
 *   - A ceiling in the grammar would TRUNCATE mid-sentence; a ceiling at
 *     validation rejects and retries with a note saying what to fix. Only the
 *     second produces a review a student can read.
 *
 * It is also deliberately NOT on evaluationResultSchema, which
 * storedEvaluationResultSchema extends: rows written before this existed carry
 * longer prose, and a ceiling there would make them fail to parse and render
 * as "no result was stored". Stored rows are read exactly as they always were.
 *
 * See lib/validation/evaluation-limits.ts for the numbers and why there are
 * two of them.
 */
const boundedProse = (field: string) =>
  z.string().max(SECTION_CEILING_CHARS, { error: tooLongMessage(field) });

const boundedSchoolFitSchema = schoolFitSchema.extend({
  classificationReason: boundedProse("classificationReason"),
  assessment: boundedProse("assessment"),
  keyRisks: z
    .array(boundedProse("a key risk"))
    .max(KEY_RISKS_CEILING, {
      error: `keyRisks lists far more than asked for — keep it to at most ${KEY_RISKS_TARGET}.`,
    })
    .optional()
    .default([]),
});

const boundedItemAssessmentSchema = itemAssessmentSchema.extend({
  compoundsInto: boundedProse("compoundsInto"),
  verdict: boundedProse("verdict"),
  howToStrengthen: boundedProse("howToStrengthen"),
});

export const evaluationOutputSchema = evaluationWireSchema.extend({
  schoolFits: z.array(boundedSchoolFitSchema),
  itemAssessments: z.array(boundedItemAssessmentSchema),
});

export type EvaluationOutputResult = z.infer<typeof evaluationOutputSchema>;

/** Flatten the wire envelope back into the shape everything else expects. */
export function fromWireResult(wire: EvaluationWireResult): EvaluationResult {
  const { overview, analysis, ...rest } = wire;
  return { ...rest, ...analysis, ...overview };
}
