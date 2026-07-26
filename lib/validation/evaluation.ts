// The contract for AI evaluation output.
//
// This schema does double duty:
//   1. zodOutputFormat() turns it into the JSON Schema sent to the model, so the
//      response is constrained to this shape at generation time.
//   2. Nothing is written to the database until safeParse() accepts it here.
//
// Keep it free of constraints structured outputs cannot express (min/max,
// minLength, regex). Enums and required fields are supported and are what
// actually matter for shape. Milestone 5 covers the OVERALL assessment and
// gaps; per-item assessments and the prioritized action list arrive in M6.
import { z } from "zod";

export const EVALUATION_STATUSES = ["pending", "completed", "failed"] as const;
export const evaluationStatusSchema = z.enum(EVALUATION_STATUSES);
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

const severitySchema = z.enum(["minor", "moderate", "significant"]);

const strengthSchema = z.object({
  title: z.string(),
  detail: z.string(),
  /** Which target(s) this helps — names, or "all". Keeps US/UK split visible. */
  relevantTo: z.array(z.string()),
});

const weaknessSchema = z.object({
  title: z.string(),
  detail: z.string(),
  severity: severitySchema,
});

const schoolFitSchema = z.object({
  schoolName: z.string(),
  country: z.string(),
  course: z.string(),
  /** Which rubric was applied — surfaced in the UI so the branch is visible. */
  rubricUsed: z.string(),
  /** 0-100. Fit against THIS school's rubric, not a generic quality score. */
  fitScore: z.number(),
  assessment: z.string(),
  keyRisks: z.array(z.string()),
});

const gapSchema = z.object({
  title: z.string(),
  detail: z.string(),
  /** School names or "all" — a gap for a UK target may be irrelevant to a US one. */
  appliesTo: z.array(z.string()),
});

export const evaluationResultSchema = z.object({
  /** 0-100 overall. Deliberately calibrated, not flattering. */
  overallScore: z.number(),
  /** One-sentence honest summary. */
  headline: z.string(),
  /** A short paragraph expanding the headline. */
  summary: z.string(),
  strengths: z.array(strengthSchema),
  weaknesses: z.array(weaknessSchema),
  narrativeCoherence: z.object({
    score: z.number(),
    assessment: z.string(),
  }),
  schoolFits: z.array(schoolFitSchema),
  gaps: z.array(gapSchema),
  /**
   * Things the model was NOT confident about. The prompt requires anything
   * uncertain — requirements, tests, policies, statistics — to land here
   * instead of being asserted as fact.
   */
  verifyThese: z.array(z.string()),
});

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type SchoolFit = z.infer<typeof schoolFitSchema>;
export type Strength = z.infer<typeof strengthSchema>;
export type Weakness = z.infer<typeof weaknessSchema>;
export type Gap = z.infer<typeof gapSchema>;

/** Parse a stored resultJson string back into a validated result, or null. */
export function parseStoredResult(json: string | null): EvaluationResult | null {
  if (!json) return null;
  try {
    const parsed = evaluationResultSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
