// Loading the previous evaluation so the next one can be consistent with it.
//
// Kept out of the route so the "which evaluation counts as the previous one"
// rule lives in one place and can be tested: the most recent COMPLETED, NON-
// SAMPLE run. Samples are placeholder text with a fixed score of 50 — anchoring
// a real evaluation to one would be worse than having no anchor at all.
import { prisma } from "@/lib/db";
import { parseStoredResult } from "@/lib/validation/evaluation";
import {
  scoresRedefinedSince,
  SCORE_KEYS,
  type ScoreKey,
} from "@/lib/prompts/evaluation/versions";
import { PROMPT_VERSION } from "@/lib/prompts/evaluation";
import {
  findReusableItemAssessments,
  NO_REUSE,
  type ItemReuse,
} from "./item-reuse";
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
  return (await loadPreviousContext(profileId, current)).diff;
}

/**
 * Everything the next run needs from the previous one: the diff that keeps
 * scores consistent, and the per-item assessments that can be carried over
 * instead of paid for again.
 *
 * One query for both — they read the same row, and the reuse rules depend on
 * the same previous snapshot the diff is built from.
 */
export async function loadPreviousContext(
  profileId: string,
  current: EvaluationSnapshot,
): Promise<{
  diff: SnapshotDiff | null;
  reuse: ItemReuse;
  /** When the previous run happened — decides whether a cache entry survives. */
  lastRunAt: Date | null;
  /**
   * Scores whose anchor has been RELEASED since the previous run, because a
   * prompt version redefined them. Empty when the anchor is fully intact.
   * Decides which model judges this run (see model-choice.ts) as well as what
   * the prompt is allowed to move.
   */
  releasedScores: ScoreKey[];
  /** The model that produced the previous run, for reporting a change of judge. */
  previousModel: string | null;
}> {
  const previous = await prisma.evaluation.findFirst({
    where: { profileId, status: "completed", isSample: false },
    orderBy: { createdAt: "desc" },
    select: {
      inputSnapshotJson: true,
      resultJson: true,
      overallScore: true,
      promptVersion: true,
      createdAt: true,
      model: true,
    },
  });

  const lastRunAt = previous?.createdAt ?? null;
  const previousModel = previous?.model ?? null;

  // Nothing usable to anchor to — no previous run, or one whose snapshot can't
  // be read. Every score counts as released: there is no prior number to hold
  // this run to, which is also what makes it a baseline run rather than a
  // follow-up. Stated outright rather than left for the caller to infer.
  const noAnchor = {
    diff: null,
    reuse: NO_REUSE,
    lastRunAt,
    releasedScores: [...SCORE_KEYS],
    previousModel,
  };

  if (!previous?.inputSnapshotJson) return noAnchor;

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
      return noAnchor;
    }
  } catch {
    return noAnchor;
  }

  const result = parseStoredResult(previous.resultJson);

  const fitScores: Record<string, number> = {};
  for (const fit of result?.schoolFits ?? []) {
    fitScores[fit.schoolName] = Math.round(fit.fitScore);
  }

  const reuse = findReusableItemAssessments(
    previousSnapshot,
    result?.itemAssessments ?? [],
    current,
    previous.promptVersion,
    PROMPT_VERSION,
  );

  // Only the scores whose definition actually changed since that run are
  // released. The rest stay anchored, so a recalibration of one number cannot
  // quietly move the others. The same list decides which model judges this run:
  // a released score has to be re-derived from scratch, and that is the
  // judgement worth paying the baseline model for.
  const releasedScores = scoresRedefinedSince(previous.promptVersion);

  const diff = buildDiff(previousSnapshot, current, {
    overallScore: previous.overallScore ?? result?.overallScore ?? null,
    gradeRelativeScore: result?.gradeRelativeScore ?? null,
    fitScores,
    promptVersion: previous.promptVersion,
    rescoredKeys: releasedScores,
  });

  return { diff, reuse, lastRunAt, releasedScores, previousModel };
}
