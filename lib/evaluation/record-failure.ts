// Recording a tier run that spent money and produced nothing usable.
//
// A Deep Review or Check-In can fail AFTER the model has been called: the
// output does not satisfy its schema, or it contains phrasing the app refuses
// to show a student. Discarding the output is right. Discarding the RECORD of
// it is not, and returning a bare 502 does exactly that:
//
//   - the tokens are already spent, on the strong model with three times the
//     context, and nothing anywhere records the cost;
//   - spend tracking never sees it, so a run of failures can burn a month's
//     budget while every counter reads zero;
//   - the student sees an error, reloads their history, and finds no trace —
//     which reads as the app having done nothing at all.
//
// /api/evaluate has recorded failures with their usage since it was written,
// for the reason its own comment gives: "a failed run still cost whatever it
// burned before failing, and that is exactly the spend someone chasing a bill
// needs to see." The tier routes are held to the same standard here.
//
// The stored row is `failed`, so nothing reads it as an evaluation: the
// dashboard, the trend chart and the history summary all filter on completed.
// It exists to be counted and to be seen.
import type { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { estimateCost } from "@/lib/cost";

/**
 * Which fields a rejected narrative got wrong, in one short line.
 *
 * Without this a shape failure is undiagnosable. The route discards the model's
 * output — correctly, it is not showable — and stores a sentence saying the
 * shape could not be read, which tells whoever is debugging nothing at all
 * about WHICH field was wrong. The first real check-in failed exactly this way
 * and the only honest next step was guesswork.
 *
 * Field paths only, never the model's values: the paths are what identify the
 * bug, and the values are prose about a student that has already been judged
 * unfit to store.
 */
export function describeShapeFailure(error: ZodError): string {
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "(root)";
    if (!seen.has(path)) seen.add(path);
    if (seen.size >= 6) break;
  }
  return [...seen].join(", ");
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

/**
 * Store a failed tier run, and return its id so the caller can hand it back.
 *
 * Never throws: this is called on the error path, and a failure to record a
 * failure must not replace the message the student was about to be given.
 */
export async function recordTierFailure(input: {
  profileId: string;
  type: "DEEP_REVIEW" | "CHECK_IN";
  model: string;
  promptVersion: string;
  rubricVersion?: string | null;
  sourceDataVersion?: string | null;
  precedingEvaluationId?: string | null;
  usage: TokenUsage;
  /** Shown to the student in their history. Plain language, no stack traces. */
  error: string;
  /**
   * The raw model output, when it failed to parse.
   *
   * Stored on the failed row so the next shape failure can be read rather than
   * reasoned about. It is never rendered: nothing treats a `failed` row as a
   * narrative, and readStoredEvaluation returns "none" for text that does not
   * parse — which is exactly what this is.
   */
  rawOutput?: string | null;
}): Promise<string | null> {
  try {
    const row = await prisma.evaluation.create({
      data: {
        profileId: input.profileId,
        type: input.type,
        status: "failed",
        error: input.error,
        // Truncated: this is a debugging artifact, not a document, and an
        // unbounded model response has no business sizing a database row.
        resultJson: input.rawOutput ? input.rawOutput.slice(0, 8000) : null,
        completedAt: new Date(),
        model: input.model,
        promptVersion: input.promptVersion,
        rubricVersion: input.rubricVersion ?? null,
        sourceDataVersion: input.sourceDataVersion ?? null,
        precedingEvaluationId: input.precedingEvaluationId ?? null,
        ...input.usage,
        costCents: Math.round((estimateCost(input.usage, input.model) ?? 0) * 100),
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error("Could not record a failed tier run:", err);
    return null;
  }
}
