// The contract for a "what if I did these things" projection.
//
// A projection is NOT an evaluation. It never touches the student's real
// scores or progress history — it answers a conditional question: if you
// actually did the things on your plan list, what would change, and which of
// them are worth the effort?
//
// The honesty requirements are stricter here than for an evaluation, because a
// hypothetical is much easier to turn into false comfort. Planning something is
// not doing it, and the prompt says so repeatedly; this schema is shaped so the
// model has to commit to which plans matter and which do not.
import { z } from "zod";

/** How much a planned item would actually be worth doing, if pursued properly. */
export const PLAN_WORTH_LEVELS = [
  "high",
  "moderate",
  "low",
  "negligible",
] as const;
export const planWorthSchema = z.enum(PLAN_WORTH_LEVELS);
export type PlanWorth = (typeof PLAN_WORTH_LEVELS)[number];

/**
 * Projected movement for ONE admissions system. Same principle as the
 * evaluation's systemScores: US and UK are never averaged together, because a
 * plan that transforms a UK course application can do almost nothing for a US
 * one, and that difference is the most useful thing a projection can tell you.
 */
const systemProjectionSchema = z.object({
  rubricId: z.string(),
  systemLabel: z.string(),
  /** Readiness today, echoed from the base evaluation (or judged if none). */
  currentReadiness: z.number(),
  /** Readiness IF every plan is completed as described — not a promise. */
  projectedReadiness: z.number(),
  /** Why it moves this much and no further, under this system's rubric. */
  reasoning: z.string(),
});

const planAssessmentSchema = z.object({
  /** Matches ProjectionSnapshot.plannedItems[].ref, e.g. "P1". */
  planRef: z.string(),
  /** Echoed back so the UI degrades gracefully if a ref can't be resolved. */
  planTitle: z.string(),
  worthDoing: planWorthSchema,
  /** Honest verdict, including "this would not move anything" when true. */
  verdict: z.string(),
  /** Target names this would actually help, or "all". Keeps US/UK visible. */
  wouldMoveNeedleFor: z.array(z.string()),
  /** What separates doing this in a way that counts from doing it pointlessly. */
  makeItCount: z.string(),
});

const sequenceStepSchema = z.object({
  title: z.string(),
  detail: z.string(),
  /** Rough window, e.g. "this term", "summer before final year". */
  when: z.string(),
});

export const projectionResultSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  /** One entry per admissions system represented in the targets. */
  systemProjections: z.array(systemProjectionSchema),
  /** One entry per planned item — the model assesses every one. */
  planAssessments: z.array(planAssessmentSchema),
  /** What order to do them in. Array order IS the recommended order. */
  sequencing: z.array(sequenceStepSchema),
  /**
   * Where this plan could go wrong: over-commitment, plans that duplicate
   * each other, plans that would cost more than they return.
   */
  cautions: z.array(z.string()),
  verifyThese: z.array(z.string()),
});

/** Lenient schema for reading stored rows, matching the evaluation pattern. */
export const storedProjectionResultSchema = projectionResultSchema.extend({
  planAssessments: z.array(planAssessmentSchema).optional().default([]),
  sequencing: z.array(sequenceStepSchema).optional().default([]),
  cautions: z.array(z.string()).optional().default([]),
  verifyThese: z.array(z.string()).optional().default([]),
});

export type ProjectionResult = z.infer<typeof projectionResultSchema>;
export type StoredProjectionResult = z.infer<
  typeof storedProjectionResultSchema
>;
export type SystemProjection = z.infer<typeof systemProjectionSchema>;
export type PlanAssessment = z.infer<typeof planAssessmentSchema>;

/** Parse a stored resultJson back into a validated projection, or null. */
export function parseStoredProjection(
  json: string | null,
): StoredProjectionResult | null {
  if (!json) return null;
  try {
    const parsed = storedProjectionResultSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
