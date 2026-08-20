// Output shapes for the two evaluation tiers, and the tier enums.
//
// The shapes differ because the questions differ. A check-in is one screen and
// exactly one action; a deep review is a document with four required sections
// and feasibility-tagged gaps. Making them the same shape at different lengths
// would collapse the distinction the whole feature rests on.
import { z } from "zod";
import { RUNGS } from "@/lib/readiness/rungs";
import { FEASIBILITY } from "@/lib/readiness/pace";
import {
  aiClassificationSchema,
  itemAssessmentSchema,
  selectivitySchema,
} from "@/lib/validation/evaluation";

export const EVALUATION_TYPES = ["CHECK_IN", "DEEP_REVIEW"] as const;
export const evaluationTypeSchema = z.enum(EVALUATION_TYPES);
export type EvaluationType = (typeof EVALUATION_TYPES)[number];

/** What the user is shown. Model names never appear in the interface. */
export const TIER_LABELS: Record<EvaluationType, string> = {
  CHECK_IN: "Check-In",
  DEEP_REVIEW: "Deep Review",
};

export const COMMITMENT_STATUSES = [
  "PROPOSED",
  "ACCEPTED",
  "IN_PROGRESS",
  "COMPLETED",
  "ABANDONED",
  /**
   * A proposal a later review replaced before the student ever answered it.
   *
   * Deliberately NOT reused from ABANDONED, which would be the tempting
   * shortcut. ABANDONED means the student looked at something and said no, and
   * a deep review reads that pattern as one of the most honest signals in the
   * table. Filing an unanswered proposal there would put a decision in their
   * mouth that they never made, and then quote it back to them as evidence.
   *
   * The student cannot reach this status: it is absent from every transition
   * in the PATCH route's ALLOWED map, so only a completing review sets it.
   */
  "SUPERSEDED",
] as const;
export const commitmentStatusSchema = z.enum(COMMITMENT_STATUSES);
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

// ── Check-in ────────────────────────────────────────────────────────────────

export const checkInNarrativeSchema = z.object({
  /** One sentence: what changed. Not a summary of the whole profile. */
  headline: z.string().trim().min(1).max(300),
  movement: z.object({
    direction: z.enum(["UP", "FLAT", "DOWN"]),
    /** What caused it. Null when nothing moved — not a filler sentence. */
    driver: z.string().trim().max(300).nullable(),
  }),
  nextRung: z
    .object({
      activityId: z.string().trim().min(1),
      currentRung: z.enum(RUNGS),
      targetRung: z.enum(RUNGS),
      concreteStep: z.string().trim().min(1).max(400),
    })
    .nullable(),
  /**
   * EXACTLY ONE, doable inside two weeks.
   *
   * A string rather than an array so the shape itself enforces it. A check-in
   * that returns five things to do is a deep review with worse context, and a
   * student handed five actions every week does none of them.
   */
  actionThisFortnight: z.string().trim().min(1).max(400),
  commitmentPrompts: z
    .array(
      z.object({
        commitmentId: z.string().trim().min(1),
        question: z.string().trim().min(1).max(300),
      }),
    )
    .max(5)
    .default([]),
});
export type CheckInNarrative = z.infer<typeof checkInNarrativeSchema>;

// ── Deep review ─────────────────────────────────────────────────────────────

export const gapItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(1200),
  /**
   * A hard filter, not a tone adjustment. TOO_LATE items still appear — a
   * student is owed the truth that something has closed — but they are never
   * dressed as achievable.
   */
  feasibility: z.enum(FEASIBILITY),
  /** Roughly how long this needs, so feasibility is checkable, not asserted. */
  monthsNeeded: z.number().int().min(0).max(60),
});

/**
 * One target, judged.
 *
 * Carried over from the evaluation this replaces, MINUS its `fitScore`. A
 * 0-100 position against one school's bar was the closest thing this app had
 * to an odds figure, and a student reading "fitScore 34" hears one number about
 * their chances. Where the profile actually stands against that course is now
 * the computed threshold snapshot — met, unmet, or not checked, per component —
 * and the reach/match/safety call remains as the judgement it always was.
 */
export const tierSchoolFitSchema = z.object({
  schoolName: z.string().trim().min(1).max(200),
  course: z.string().trim().max(200),
  /** Which rubric was applied, so the US/UK branch stays visible. */
  rubricUsed: z.string().trim().max(120),
  selectivity: selectivitySchema,
  classification: aiClassificationSchema,
  classificationReason: z.string().trim().min(1).max(800),
  assessment: z.string().trim().min(1).max(1500),
  keyRisks: z.array(z.string().trim().min(1).max(400)).max(6).default([]),
});

export const deepReviewNarrativeSchema = z.object({
  /** One sentence, for the dashboard and the timeline. */
  headline: z.string().trim().min(1).max(300),
  /**
   * Must open against the previous deep review, or state plainly that this is
   * the baseline. A review that starts from nowhere gives a student no way to
   * tell movement from noise.
   */
  sinceLastReview: z.string().trim().min(1).max(1200),
  trajectory: z.object({
    assessment: z.string().trim().min(1).max(1500),
    /** Slope, not level: the level is already in the computed bands. */
    direction: z.enum(["STEEPENING", "STEADY", "FLATTENING"]),
  }),
  coherence: z.object({
    assessment: z.string().trim().min(1).max(1500),
    /** Named specifically. "Be more coherent" is not usable by anyone. */
    incoherences: z.array(z.string().trim().min(1).max(400)).max(6).default([]),
  }),
  differentiation: z.object({
    assessment: z.string().trim().min(1).max(1500),
    escalationOpportunities: z
      .array(z.string().trim().min(1).max(400))
      .max(6)
      .default([]),
  }),
  /**
   * Per target. Absorbed from the evaluation this replaces, because the whole
   * point of naming targets is to be told where you stand against each one —
   * and a single profile-wide read cannot say that.
   */
  schoolFits: z.array(tierSchoolFitSchema).max(20).default([]),
  /**
   * One per resume item. Also absorbed: it is the most-read part of the old
   * evaluation, and dropping it in a "replacement" would be a downgrade the
   * student never asked for.
   */
  itemAssessments: z.array(itemAssessmentSchema).max(60).default([]),
  gaps: z.array(gapItemSchema).max(10).default([]),
  /**
   * Anything the model is not certain of. The app's oldest rule: never assert
   * an admissions fact you cannot source, put it here instead.
   */
  verifyThese: z.array(z.string().trim().min(1).max(400)).max(15).default([]),
  /**
   * Proposed for the student to accept or decline.
   *
   * Unconstrained on count and length because this schema is now a READER.
   * The tier that produced these rows is retired, so nothing validates a fresh
   * response against it — the only thing a `.min(2)` can do here is refuse to
   * render a stored review, which is the failure this file's neighbours have
   * been fixed for twice already.
   */
  proposedCommitments: z.array(
    z.object({
      description: z.string().trim(),
      targetRung: z.enum(RUNGS).nullable(),
      /** Weeks from the review, which the server turned into a real date. */
      dueInWeeks: z.number(),
    }),
  ),
});
export type DeepReviewNarrative = z.infer<typeof deepReviewNarrativeSchema>;

/**
 * Phrasings neither tier may produce.
 *
 * The constraint is absolute: no admission probability, in any form, hedged or
 * not. It is the one claim this app cannot make honestly — nobody can — and a
 * teenager reading "roughly 12%" will carry that number around as though
 * someone knew it.
 *
 * Percent signs are banned outright rather than contextually, because every
 * legitimate use here has a non-numeric alternative (bands, rungs, counts) and
 * a rule with exceptions is a rule a model will find the exception to.
 */
export const BANNED_OUTPUT_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: /%/, why: "percentage" },
  { pattern: /\bpercent(age)?\b/i, why: "percentage" },
  { pattern: /\bprobabilit(y|ies)\b/i, why: "probability" },
  { pattern: /\bodds\b/i, why: "odds" },
  { pattern: /\bchances?\s+(of|at|are)\b/i, why: "chance of admission" },
  { pattern: /\blikelihood\b/i, why: "likelihood" },
  { pattern: /\b\d+\s*(in|out of)\s*\d+\s+(chance|applicants|students)\b/i, why: "odds ratio" },
  { pattern: /\bacceptance rate\b/i, why: "acceptance rate" },
  { pattern: /\badmit rate\b/i, why: "admit rate" },
  { pattern: /\byou (will|won't|will not) get (in|into)\b/i, why: "admission prediction" },
];

/** Every banned phrasing found in a narrative. Empty is the passing case. */
export function findBannedPhrasing(value: unknown): string[] {
  const text = JSON.stringify(value ?? "");
  const found = new Set<string>();
  for (const { pattern, why } of BANNED_OUTPUT_PATTERNS) {
    if (pattern.test(text)) found.add(why);
  }
  return [...found];
}
