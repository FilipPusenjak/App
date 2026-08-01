// What changed since the last evaluation.
//
// WHY THIS EXISTS
// Evaluations used to be completely independent: the model had never seen its
// own previous verdict and no definition of what a given score meant. Two
// consequences, both reported as bugs by a real user:
//
//   1. Scores drifted between runs on an unchanged profile, because "50" was
//      whatever the model felt that run.
//   2. ADDING content could LOWER the score. More items give an honest critic
//      more to criticize, so the number fell even though the profile improved.
//      A measurement that moves the wrong way on new information is broken.
//
// So each evaluation now carries the previous one's scores plus an explicit
// diff of the profile. The prompt uses `onlyGained` to forbid an unexplained
// drop: if nothing was removed or weakened, the score may not fall unless the
// model names a specific addition that actively damages the profile.
import type { EvaluationSnapshot } from "./snapshot";
import type { ScoreKey } from "@/lib/prompts/evaluation/versions";

export type PreviousScores = {
  overallScore: number | null;
  gradeRelativeScore: number | null;
  /** Per-target fit, keyed by school name. */
  fitScores: Record<string, number>;
  /** Which prompt produced them, e.g. "evaluation/v6". */
  promptVersion?: string | null;
  /**
   * Which scores have been REDEFINED since those numbers were produced, and
   * are therefore measurements of something that no longer exists.
   *
   * Consistency anchoring and recalibration are direct opposites, and without
   * this anchoring silently wins: told "the profile is unchanged, so keep your
   * scores the same" AND "here is a new definition of the score", a model
   * follows the concrete instruction with a number attached. A redefinition
   * then has no effect on any existing user, which is exactly backwards.
   *
   * Per-score, because releasing every anchor together is its own bug — a
   * version that redefined only gradeRelativeScore let a readiness score fall
   * eight points for no reason anyone could name.
   */
  rescoredKeys?: ScoreKey[];
};

export type SnapshotDiff = {
  previousAt: string;
  previousScores: PreviousScores;
  addedItems: string[];
  removedItems: string[];
  addedTestScores: string[];
  removedTestScores: string[];
  addedTargets: string[];
  removedTargets: string[];
  /** Human-readable "GPA: 3.8 -> 3.9" lines for changed profile fields. */
  changedFields: string[];
  /**
   * True when the profile only grew: things were added, nothing removed, and
   * no field was emptied. This is the case where a falling score needs a
   * specific justification.
   */
  onlyGained: boolean;
  /** True when nothing at all changed — scores should then be stable. */
  unchanged: boolean;
};

const itemLabel = (i: { title: string; org: string | null }) =>
  i.org ? `${i.title} (${i.org})` : i.title;

const scoreLabel = (t: { label: string; score: string }) =>
  `${t.label}: ${t.score}`;

function difference(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((x) => !beforeSet.has(x)),
    removed: before.filter((x) => !afterSet.has(x)),
  };
}

/** Profile fields whose change is worth telling the model about. */
const TRACKED_FIELDS: {
  key: keyof EvaluationSnapshot["student"];
  label: string;
}[] = [
  { key: "gradeLevel", label: "Grade level" },
  { key: "curriculum", label: "Curriculum" },
  { key: "gpa", label: "GPA" },
  { key: "gpaScale", label: "GPA scale" },
  { key: "intendedMajor", label: "Intended major" },
  { key: "careerGoal", label: "Career goal" },
  { key: "schoolName", label: "School" },
  { key: "schoolContext", label: "School context" },
];

export function buildDiff(
  previous: EvaluationSnapshot,
  current: EvaluationSnapshot,
  previousScores: PreviousScores,
): SnapshotDiff {
  const items = difference(
    previous.resumeItems.map(itemLabel),
    current.resumeItems.map(itemLabel),
  );
  const tests = difference(
    previous.testScores.map(scoreLabel),
    current.testScores.map(scoreLabel),
  );
  const targets = difference(
    previous.targets.map((t) => t.name),
    current.targets.map((t) => t.name),
  );

  const changedFields: string[] = [];
  let fieldWeakened = false;
  for (const { key, label } of TRACKED_FIELDS) {
    const before = previous.student[key];
    const after = current.student[key];
    if (before === after) continue;
    const had = before != null && before !== "";
    const has = after != null && after !== "";

    // Clearing a field loses information the last evaluation had.
    if (had && !has) fieldWeakened = true;
    // A FALLING GPA is a real weakening, not a gain. Without this, dropping
    // from 3.9 to 3.8 would still count as "only gained" and the prompt would
    // wrongly forbid the score from going down.
    if (key === "gpa" && typeof before === "number" && typeof after === "number") {
      if (after < before) fieldWeakened = true;
    }
    // Long free text (school context) is reported as changed rather than
    // pasted in full — the current value is already in the snapshot.
    const short = key !== "schoolContext";
    changedFields.push(
      short
        ? `${label}: ${had ? String(before) : "not set"} -> ${has ? String(after) : "not set"}`
        : `${label}: ${had ? "was described" : "was not set"} -> ${has ? "now described" : "now empty"}`,
    );
  }

  const nothingRemoved =
    items.removed.length === 0 &&
    tests.removed.length === 0 &&
    !fieldWeakened;
  const somethingAdded =
    items.added.length > 0 ||
    tests.added.length > 0 ||
    changedFields.length > 0;

  return {
    previousAt: previous.capturedAt,
    previousScores,
    addedItems: items.added,
    removedItems: items.removed,
    addedTestScores: tests.added,
    removedTestScores: tests.removed,
    addedTargets: targets.added,
    removedTargets: targets.removed,
    changedFields,
    onlyGained: somethingAdded && nothingRemoved,
    unchanged:
      !somethingAdded &&
      nothingRemoved &&
      targets.added.length === 0 &&
      targets.removed.length === 0,
  };
}
