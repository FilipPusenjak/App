// Reading an evaluation that may be in either shape.
//
// Evaluations are immutable and pinned to the version that produced them, and
// nothing recomputes them when the rubric or the output shape moves on. That is
// a deliberate guarantee — but it has a consequence that has to be built for
// rather than discovered: THE APP MUST READ BOTH SHAPES FOREVER.
//
// A student who ran evaluations under the old shape still owns them. If the
// detail page only understood the new one, their history would not merely look
// different — it would stop rendering, which is the same as losing it.
//
// The discriminator is `promptVersion`, not a guess at the JSON: "evaluation/*"
// is the legacy shape, "deep-review/*" is the current one. Explicit, because
// duck-typing two schemas that share field names ("gaps", "headline") would
// misclassify on exactly the rows where being wrong matters most.
import {
  evaluationResultSchema,
  type EvaluationResult,
} from "@/lib/validation/evaluation";
import {
  deepReviewNarrativeSchema,
  checkInNarrativeSchema,
  type CheckInNarrative,
  type DeepReviewNarrative,
} from "@/lib/validation/tiers";

export type StoredShape =
  | { kind: "legacy"; result: EvaluationResult }
  | { kind: "deep-review"; result: DeepReviewNarrative }
  | { kind: "check-in"; result: CheckInNarrative }
  | { kind: "none" };

export function readStoredEvaluation(row: {
  promptVersion: string | null;
  resultJson: string | null;
  type?: string | null;
}): StoredShape {
  if (!row.resultJson) return { kind: "none" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.resultJson);
  } catch {
    return { kind: "none" };
  }

  const version = row.promptVersion ?? "";

  if (version.startsWith("check-in/")) {
    const result = checkInNarrativeSchema.safeParse(parsed);
    return result.success ? { kind: "check-in", result: result.data } : { kind: "none" };
  }

  if (version.startsWith("deep-review/")) {
    const result = deepReviewNarrativeSchema.safeParse(parsed);
    return result.success
      ? { kind: "deep-review", result: result.data }
      : { kind: "none" };
  }

  // Everything else is legacy: "evaluation/v1" through "evaluation/v10", and
  // rows written before promptVersion was recorded at all.
  const legacy = evaluationResultSchema.safeParse(parsed);
  if (legacy.success) return { kind: "legacy", result: legacy.data };

  // A version string we do not recognise, on JSON neither schema accepts. Try
  // both before giving up, so an unrecorded version does not lose a real row.
  const asDeep = deepReviewNarrativeSchema.safeParse(parsed);
  if (asDeep.success) return { kind: "deep-review", result: asDeep.data };
  const asCheckIn = checkInNarrativeSchema.safeParse(parsed);
  if (asCheckIn.success) return { kind: "check-in", result: asCheckIn.data };

  return { kind: "none" };
}

/**
 * The one line that represents an evaluation anywhere it is summarised.
 *
 * Both shapes have a headline; the legacy one calls it the same thing. Kept in
 * one function so the dashboard, the timeline and the history list cannot drift
 * into showing three different summaries of the same row.
 */
export function headlineOf(shape: StoredShape): string | null {
  switch (shape.kind) {
    case "legacy":
      return shape.result.headline;
    case "deep-review":
      return shape.result.headline;
    case "check-in":
      return shape.result.headline;
    case "none":
      return null;
  }
}

/**
 * Whether this row can be compared to that one.
 *
 * Two evaluations in different shapes measure different things — percentiles
 * against bands — so a chart must not draw a line between them. It is the same
 * rule as a rubric-version boundary and for the same reason: the change is in
 * the measurement, not in the student.
 */
export function comparableShapes(a: StoredShape, b: StoredShape): boolean {
  return a.kind === b.kind && a.kind !== "none";
}
