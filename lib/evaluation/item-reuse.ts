// Carrying per-item assessments forward instead of paying to rewrite them.
//
// Output is around 80% of what an evaluation costs, and per-item assessments
// are the largest part of it: eight fields per item, every item, every run. A
// student who adds one activity to a list of twelve pays for all twelve to be
// judged again — and gets twelve answers that should be identical to last
// time, because eleven of the items did not change.
//
// So the unchanged ones are carried over from the previous evaluation and the
// model is asked to assess only what is new. That saves roughly the share of
// the output those items occupied, and it has a second benefit worth as much
// as the money: an unchanged item now gets a genuinely unchanged verdict,
// rather than a re-roll that can quietly contradict the last one.
//
// The rules below are deliberately strict. A wrong reuse is invisible — it
// looks exactly like a fresh assessment — so anything that could plausibly
// change a judgement disqualifies the item.
import { itemAssessmentSchema, type ItemAssessment } from "@/lib/validation/evaluation";
import type { EvaluationSnapshot } from "./snapshot";

export type ItemReuse = {
  /** Current-snapshot ref -> the assessment carried over for it. */
  byRef: Record<string, ItemAssessment>;
  /** Refs the model is told to leave out, in snapshot order. */
  skipRefs: string[];
};

export const NO_REUSE: ItemReuse = { byRef: {}, skipRefs: [] };

type SnapshotItem = EvaluationSnapshot["resumeItems"][number];

/** Everything about an item that could change how it is judged. */
function itemFingerprint(item: SnapshotItem): string {
  return JSON.stringify([
    item.id,
    item.type,
    item.title,
    item.org,
    item.description,
    item.startDate,
    item.endDate,
    item.hoursPerWeek,
    item.evidenceNotes,
  ]);
}

/**
 * Facts about the student that change what an item is WORTH, as opposed to
 * facts about the student generally.
 *
 * Stage drives foundationalValue, and the intended direction drives relevance
 * — so a student moving into a new year, or deciding they now want to study
 * something else, invalidates every carried-over verdict. GPA and school do
 * not: they change the profile's strength without changing what a given
 * activity is worth to it.
 */
function judgementContext(snapshot: EvaluationSnapshot): string {
  return JSON.stringify([
    snapshot.student.gradeLevel,
    snapshot.student.intendedMajor,
    snapshot.student.careerGoal,
    // bestFor and helpfulness are stated per target, so any change to the
    // target list makes a previous verdict unsafe to reuse.
    snapshot.targets.map((t) => [t.name, t.country, t.course]),
  ]);
}

/**
 * Which of the current items already have an assessment that can be reused.
 *
 * Returns nothing at all unless the previous evaluation came from the SAME
 * prompt version: a different version may have redefined what these fields
 * mean, and mixing two definitions inside one list would be worse than paying
 * for the re-assessment.
 */
export function findReusableItemAssessments(
  previousSnapshot: EvaluationSnapshot,
  previousAssessments: unknown[],
  current: EvaluationSnapshot,
  previousPromptVersion: string | null | undefined,
  currentPromptVersion: string,
): ItemReuse {
  if (!previousPromptVersion || previousPromptVersion !== currentPromptVersion) {
    return NO_REUSE;
  }
  if (judgementContext(previousSnapshot) !== judgementContext(current)) {
    return NO_REUSE;
  }

  // Previous assessments, keyed by the ref they were written against.
  const byPreviousRef = new Map<string, ItemAssessment>();
  for (const raw of previousAssessments) {
    // Must satisfy the STRICT contract: a row written before a field existed
    // would carry it forward as missing and fail validation later.
    const parsed = itemAssessmentSchema.safeParse(raw);
    if (parsed.success) byPreviousRef.set(parsed.data.itemRef, parsed.data);
  }
  if (byPreviousRef.size === 0) return NO_REUSE;

  // Items are matched by content, not by position: refs are positional, so
  // removing one item shifts every ref after it.
  const previousByFingerprint = new Map<string, string>();
  for (const item of previousSnapshot.resumeItems) {
    previousByFingerprint.set(itemFingerprint(item), item.ref);
  }

  const byRef: Record<string, ItemAssessment> = {};
  const skipRefs: string[] = [];
  for (const item of current.resumeItems) {
    const previousRef = previousByFingerprint.get(itemFingerprint(item));
    if (!previousRef) continue;
    const assessment = byPreviousRef.get(previousRef);
    if (!assessment) continue;

    // Re-point it at this snapshot's ref, which may have moved.
    byRef[item.ref] = { ...assessment, itemRef: item.ref };
    skipRefs.push(item.ref);
  }

  return { byRef, skipRefs };
}

/**
 * Combine the model's fresh assessments with the carried-over ones, in
 * snapshot order.
 *
 * A fresh assessment always wins: if the model assessed an item anyway, that
 * judgement is the current one and the stored copy is discarded.
 */
export function mergeItemAssessments(
  snapshot: EvaluationSnapshot,
  fresh: ItemAssessment[],
  reuse: ItemReuse,
): ItemAssessment[] {
  const freshByRef = new Map(fresh.map((a) => [a.itemRef, a]));
  const merged: ItemAssessment[] = [];

  for (const item of snapshot.resumeItems) {
    const assessment = freshByRef.get(item.ref) ?? reuse.byRef[item.ref];
    if (assessment) merged.push(assessment);
  }

  // Anything the model returned against a ref this snapshot does not have —
  // a hallucinated ref — is dropped rather than shown to the student.
  return merged;
}

/** The prompt section telling the model which items NOT to assess. */
export function renderItemReuse(
  reuse: ItemReuse,
  snapshot: EvaluationSnapshot,
): string | null {
  if (reuse.skipRefs.length === 0) return null;

  const remaining = snapshot.resumeItems
    .filter((i) => !reuse.skipRefs.includes(i.ref))
    .map((i) => i.ref);

  const lines = [
    `These items are UNCHANGED since your last evaluation and their assessments are being carried over verbatim: ${reuse.skipRefs.join(", ")}.`,
    "",
    "DO NOT include them in itemAssessments. Leaving them out is correct and expected — the app inserts the previous assessments itself, so writing them again only costs the student money and risks contradicting a verdict they have already read.",
  ];

  lines.push(
    remaining.length > 0
      ? `Assess ONLY these, which are new or changed: ${remaining.join(", ")}.`
      : "Every item is unchanged, so itemAssessments must be an empty array.",
  );
  lines.push(
    "Still read the carried-over items as part of the profile. They count towards every score, every strength and weakness, and the narrative — they are simply not re-described one by one.",
  );

  return lines.join("\n");
}
