// The measured starting point a projection moves from.
//
// A projection is expressed in percentiles: "45 -> 58" only means something if
// the 45 was measured rather than guessed. That makes the choice of base row
// load-bearing in a way it did not used to be, now that a student's most recent
// evaluation may be a deep review — which measures in BANDS, and whose bands are
// never converted into scores (see lib/dashboard/standing.ts).
//
// So this reaches past band-shaped runs to the most recent percentile one. The
// alternative, taking whatever ran last, would hand the model an empty baseline
// while the surrounding code still called it a baseline, and the projection
// would go back to inventing its own starting number — silently, and only for
// students who had adopted the newer tier.
//
// Ownership is the caller's job: it passes rows it has already scoped to the
// signed-in user's profile. Nothing here queries.
import { readStoredEvaluation } from "@/lib/evaluation/stored-shape";
import type { EvaluationResult } from "@/lib/validation/evaluation";

/** How many recent evaluations to look back through for a percentile run. */
export const BASELINE_LOOKBACK = 20;

export type BaselineRow = {
  id: string;
  createdAt: Date;
  overallScore: number | null;
  resultJson: string | null;
  promptVersion: string | null;
};

export type ProjectionBaseline = {
  evaluationId: string | null;
  capturedAt: string | null;
  overallScore: number | null;
  /** Per-system readiness, keyed by rubric id. */
  systemReadiness: Record<string, number>;
};

/**
 * Pick the baseline from candidate rows, newest first.
 *
 * Returns an empty baseline rather than a wrong one when the student has never
 * run a percentile evaluation. That is a real state — someone who started on
 * deep reviews has no percentile history — and an absent baseline the prompt
 * can see is better than a fabricated one it cannot.
 */
export function selectProjectionBaseline(
  candidates: BaselineRow[],
): ProjectionBaseline {
  for (const candidate of candidates) {
    const shape = readStoredEvaluation(candidate);
    if (shape.kind !== "legacy") continue;
    return {
      evaluationId: candidate.id,
      capturedAt: candidate.createdAt.toISOString(),
      overallScore: candidate.overallScore ?? shape.result.overallScore,
      systemReadiness: systemReadinessOf(shape.result),
    };
  }

  return {
    evaluationId: null,
    capturedAt: null,
    overallScore: null,
    systemReadiness: {},
  };
}

function systemReadinessOf(result: EvaluationResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sys of result.systemScores) {
    out[sys.rubricId] = Math.round(sys.readinessScore);
  }
  return out;
}
