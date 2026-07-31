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

export const CLASSIFICATIONS_AI = ["reach", "match", "safety"] as const;
export const aiClassificationSchema = z.enum(CLASSIFICATIONS_AI);
export type AiClassification = (typeof CLASSIFICATIONS_AI)[number];

/**
 * How high a bar this course sets — the missing variable that made fit scores
 * meaningless.
 *
 * Without it, "fit" collapsed into "how impressive is this profile in absolute
 * terms", so a 4.0 student was told they were a 58 for a large public
 * university that admits the large majority of qualified applicants. Fit is
 * profile measured against a BAR, and the bar has to be named for the
 * measurement to mean anything.
 *
 * Coarse on purpose. The model is still forbidden from stating or estimating
 * any acceptance rate — a five-way tier is a judgment it can make reliably,
 * where a number would be a fabricated statistic.
 */
export const SELECTIVITY_TIERS = [
  "open",
  "accessible",
  "selective",
  "highly_selective",
  "extremely_selective",
] as const;
export const selectivitySchema = z.enum(SELECTIVITY_TIERS);
export type Selectivity = (typeof SELECTIVITY_TIERS)[number];

const schoolFitSchema = z.object({
  schoolName: z.string(),
  course: z.string(),
  /** Which rubric was applied — surfaced in the UI so the branch is visible. */
  rubricUsed: z.string(),
  /** How high this course's bar sits. fitScore is meaningless without it. */
  selectivity: selectivitySchema,
  /**
   * 0-100. This student's position for admission to THIS course — profile
   * measured against THIS school's bar, NOT the headline percentile restated.
   * A modest profile can and should score very high at an accessible school.
   */
  fitScore: z.number(),
  /**
   * The model's own reach/match/safety call. This used to be the student's
   * guess on the form; it depends on the profile, so the evaluation decides it.
   */
  classification: aiClassificationSchema,
  classificationReason: z.string(),
  assessment: z.string(),
  keyRisks: z.array(z.string()),
});

/**
 * When a gap is actually actionable.
 *
 * "later" exists because the app was telling Grade 9 students their biggest
 * gap was having no admissions test score — something they cannot sit for two
 * more years. A locked door is not a gap, and presenting it as one creates
 * anxiety about the one thing the student can do nothing about.
 */
export const GAP_TIMINGS = ["now", "soon", "later"] as const;
export const gapTimingSchema = z.enum(GAP_TIMINGS);
export type GapTiming = (typeof GAP_TIMINGS)[number];

const gapSchema = z.object({
  title: z.string(),
  detail: z.string(),
  /**
   * "now" = reachable at this stage and not being done — a real gap.
   * "soon" = becomes reachable at the next stage; worth knowing, not acting on.
   * "later" = gated behind prerequisites the student cannot have yet. Never
   * frame these as failings.
   */
  timing: gapTimingSchema,
  /** School names or "all" — a gap for a UK target may be irrelevant to a US one. */
  appliesTo: z.array(z.string()),
});

/** Whether the student is building the right foundations FOR THEIR STAGE. */
export const STAGE_TRACKS = [
  "ahead",
  "on_track",
  "slightly_behind",
  "behind",
] as const;
export const stageTrackSchema = z.enum(STAGE_TRACKS);
export type StageTrack = (typeof STAGE_TRACKS)[number];

/**
 * The positive read of a student's stage that the app previously lacked
 * entirely. Every rubric dimension describes a finished application, so an
 * early-years student scored as though empty no matter what they did. This
 * asks the question that actually matters at that point: are the right
 * foundations being laid?
 */
const stageOutlookSchema = z.object({
  /** Which stage the student is at, e.g. "Early — Grade 9-10". */
  stageLabel: z.string(),
  /** What this stage is for, in the student's own situation. */
  whatMattersNow: z.string(),
  onTrack: stageTrackSchema,
  /** Honest read of the foundations — not of the finished application. */
  assessment: z.string(),
  /** Things genuinely reachable at this stage that they have NOT started. */
  reachableNow: z.array(z.string()),
  /** Things correctly absent because they are gated — named to defuse worry. */
  notYetExpected: z.array(z.string()),
});

/** How much an individual resume item actually helps. "negligible" exists so
 *  the model has an honest option for filler — it is instructed to use it. */
export const HELPFULNESS_LEVELS = [
  "high",
  "moderate",
  "low",
  "negligible",
] as const;
export const helpfulnessSchema = z.enum(HELPFULNESS_LEVELS);
export type Helpfulness = (typeof HELPFULNESS_LEVELS)[number];

export const EFFORT_LEVELS = ["low", "medium", "high"] as const;
export const effortSchema = z.enum(EFFORT_LEVELS);
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const IMPACT_LEVELS = ["low", "medium", "high"] as const;
export const impactSchema = z.enum(IMPACT_LEVELS);
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

/**
 * How much an item is worth as a FOUNDATION, separately from what it is worth
 * to an application today.
 *
 * These come apart sharply in the early years, and only measuring the second
 * one made everything a 14-year-old does look worthless. A club joined in
 * Grade 9 that becomes a leadership role and a body of work by Grade 12 has
 * enormous foundational value and almost no present value; the identical club
 * joined in Grade 12 has neither.
 */
export const FOUNDATIONAL_VALUES = ["high", "moderate", "low", "none"] as const;
export const foundationalValueSchema = z.enum(FOUNDATIONAL_VALUES);
export type FoundationalValue = (typeof FOUNDATIONAL_VALUES)[number];

const itemAssessmentSchema = z.object({
  /** Matches EvaluationSnapshot.resumeItems[].ref, e.g. "R1". */
  itemRef: z.string(),
  /** Echoed back so the UI degrades gracefully if a ref can't be resolved. */
  itemTitle: z.string(),
  helpfulness: helpfulnessSchema,
  /** What this is worth as something to build ON, given the student's stage. */
  foundationalValue: foundationalValueSchema,
  /** What it could realistically become if sustained — the compounding case. */
  compoundsInto: z.string(),
  /** Why it helps or doesn't — honest, not encouraging. */
  verdict: z.string(),
  /** Concrete, doable step that would make this specific item stronger. */
  howToStrengthen: z.string(),
  /** Which targets it actually helps — keeps the US/UK asymmetry visible
   *  at the level of individual activities. */
  bestFor: z.array(z.string()),
});

const actionSchema = z.object({
  title: z.string(),
  detail: z.string(),
  effort: effortSchema,
  impact: impactSchema,
  /** Rough window, e.g. "this month", "before applications". */
  timeframe: z.string(),
  appliesTo: z.array(z.string()),
});

/**
 * A readiness score for ONE admissions system, not blended across systems.
 *
 * A single overall number across US and UK targets is exactly the flattening
 * this app exists to avoid: the two systems reward different things, so one
 * average is a number about nothing. These sit alongside overallScore, which
 * remains the whole-profile headline.
 */
const systemScoreSchema = z.object({
  /** The rubric this score was produced under, e.g. "us-holistic". */
  rubricId: z.string(),
  /** Display label for the system, e.g. "United States — holistic review". */
  systemLabel: z.string(),
  /** 0-100 readiness for THIS system's targets, under THIS system's rubric. */
  readinessScore: z.number(),
  /** 0-100 versus same-stage students aiming at this system. */
  gradeRelativeScore: z.number(),
  /** Why this system's number differs from the other's — the useful part. */
  assessment: z.string(),
});

export const evaluationResultSchema = z.object({
  /**
   * 0-100 readiness against the student's NAMED TARGETS, as they stand today.
   * A strong Grade 9 profile can score low here simply because there are years
   * of work left — that is the honest reading, and it is why gradeRelativeScore
   * exists alongside it.
   */
  overallScore: z.number(),
  /**
   * 0-100 relative to a realistic pool of students AT THE SAME STAGE. This is
   * the fair-comparison number: it answers "how am I doing for my year?"
   * rather than "am I ready to apply?".
   */
  gradeRelativeScore: z.number(),
  /** Why the two scores differ, and what stage-appropriate progress looks like. */
  gradeContext: z.string(),
  /** Are the right foundations being laid for this student's stage? */
  stageOutlook: stageOutlookSchema,
  /**
   * One entry per admissions system represented in the targets. Keeps the US
   * and UK reads separate at the headline level, not just per school.
   */
  systemScores: z.array(systemScoreSchema),
  /**
   * How the profile and the scores moved since the previous evaluation, and
   * why. Exists because scores used to drift between runs with no explanation,
   * and could fall when the student ADDED work — which made the number
   * untrustworthy. When there is no previous evaluation this says so.
   */
  changeSinceLast: z.string(),
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
  /** One entry per resume item — the model is told to assess every one. */
  itemAssessments: z.array(itemAssessmentSchema),
  /** Prioritized: array order IS the priority, highest first. */
  actions: z.array(actionSchema),
  gaps: z.array(gapSchema),
  /**
   * Things the model was NOT confident about. The prompt requires anything
   * uncertain — requirements, tests, policies, statistics — to land here
   * instead of being asserted as fact.
   */
  verifyThese: z.array(z.string()),
});

/**
 * Lenient schema for READING stored rows.
 *
 * Evaluations saved before Milestone 6 have no itemAssessments or actions.
 * Requiring them here would make every older evaluation fail to parse and
 * render as blank, so they default to empty when absent. New AI output is still
 * validated against the strict schema above, which requires them.
 */
export const storedEvaluationResultSchema = evaluationResultSchema.extend({
  actions: z.array(actionSchema).optional().default([]),
  // Added in prompt v3. Left undefined (not defaulted to a number) on older
  // evaluations so the UI can omit the section rather than display a fabricated
  // score of 0.
  gradeRelativeScore: z.number().optional(),
  gradeContext: z.string().optional(),
  // Added in prompt v4. Same rule: absent on older rows, so the UI omits those
  // sections rather than inventing a score or a change that was never assessed.
  systemScores: z.array(systemScoreSchema).optional().default([]),
  changeSinceLast: z.string().optional(),
  // Added in prompt v5. Older rows have no stage reading, no gap timing and no
  // foundational value; those stay absent rather than being invented.
  stageOutlook: stageOutlookSchema.optional(),
  gaps: z.array(gapSchema.extend({ timing: gapTimingSchema.optional() })),
  // Single definition for stored item assessments: pre-M6 rows have none at
  // all, pre-v5 rows have them without the foundational fields.
  itemAssessments: z
    .array(
      itemAssessmentSchema.extend({
        foundationalValue: foundationalValueSchema.optional(),
        compoundsInto: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  schoolFits: z.array(
    schoolFitSchema.extend({
      classification: aiClassificationSchema.optional(),
      classificationReason: z.string().optional(),
      // Added in prompt v6. Rows written before it have no selectivity read, so
      // the UI omits the tier rather than asserting one that was never judged.
      selectivity: selectivitySchema.optional(),
      // Asked of the model up to v6, then dropped: it is a display name the app
      // already has on the target, and every property costs grammar. Older rows
      // still carry it, and the UI shows it when present.
      country: z.string().optional(),
    }),
  ),
});

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type StoredEvaluationResult = z.infer<typeof storedEvaluationResultSchema>;
export type SchoolFit = z.infer<typeof schoolFitSchema>;
export type Strength = z.infer<typeof strengthSchema>;
export type Weakness = z.infer<typeof weaknessSchema>;
export type Gap = z.infer<typeof gapSchema>;
export type SystemScore = z.infer<typeof systemScoreSchema>;
export type StageOutlook = z.infer<typeof stageOutlookSchema>;
export type ItemAssessment = z.infer<typeof itemAssessmentSchema>;
export type Action = z.infer<typeof actionSchema>;

/** Parse a stored resultJson string back into a validated result, or null. */
export function parseStoredResult(
  json: string | null,
): StoredEvaluationResult | null {
  if (!json) return null;
  try {
    const parsed = storedEvaluationResultSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
