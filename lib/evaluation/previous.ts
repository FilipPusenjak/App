// Loading the previous evaluation so the next one can be consistent with it.
//
// Kept out of the route so the "which evaluation counts as the previous one"
// rule lives in one place and can be tested: the most recent COMPLETED, NON-
// SAMPLE run. Samples are placeholder text with a fixed score of 50 — anchoring
// a real evaluation to one would be worse than having no anchor at all.
import { prisma } from "@/lib/db";
import { parseStoredResult } from "@/lib/validation/evaluation";
import { buildDiff, type SnapshotDiff } from "./diff";
import type { EvaluationSnapshot } from "./snapshot";

/**
 * Build the diff between the current snapshot and the previous real evaluation
 * for this profile, or null when there is nothing usable to compare against.
 *
 * Scoped by profileId, which callers only ever get from the ownership helpers.
 * Anything unreadable (a pre-v3 row, corrupt JSON, a missing snapshot) yields
 * null rather than throwing — a failed comparison must never break a run.
 */
export async function buildDiffAgainstPrevious(
  profileId: string,
  current: EvaluationSnapshot,
): Promise<SnapshotDiff | null> {
  const previous = await prisma.evaluation.findFirst({
    where: { profileId, status: "completed", isSample: false },
    orderBy: { createdAt: "desc" },
    select: { inputSnapshotJson: true, resultJson: true, overallScore: true },
  });

  if (!previous?.inputSnapshotJson) return null;

  let previousSnapshot: EvaluationSnapshot;
  try {
    previousSnapshot = JSON.parse(
      previous.inputSnapshotJson,
    ) as EvaluationSnapshot;
    // A snapshot from a much older version may not have the shape we expect.
    if (
      !Array.isArray(previousSnapshot.resumeItems) ||
      !Array.isArray(previousSnapshot.testScores) ||
      !Array.isArray(previousSnapshot.targets) ||
      typeof previousSnapshot.student !== "object"
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const result = parseStoredResult(previous.resultJson);

  const fitScores: Record<string, number> = {};
  for (const fit of result?.schoolFits ?? []) {
    fitScores[fit.schoolName] = Math.round(fit.fitScore);
  }

  return buildDiff(previousSnapshot, current, {
    overallScore: previous.overallScore ?? result?.overallScore ?? null,
    gradeRelativeScore: result?.gradeRelativeScore ?? null,
    fitScores,
  });
}
