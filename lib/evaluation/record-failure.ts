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
import { prisma } from "@/lib/db";
import { estimateCost } from "@/lib/cost";

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
}): Promise<string | null> {
  try {
    const row = await prisma.evaluation.create({
      data: {
        profileId: input.profileId,
        type: input.type,
        status: "failed",
        error: input.error,
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
