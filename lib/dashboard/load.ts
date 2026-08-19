// Everything the dashboard shows, loaded for the signed-in user only.
//
// Every read here goes through lib/ownership, which resolves the active
// profile from the authenticated session and never from anything a client
// sends. That is the whole reason this file exists rather than the page
// querying Prisma directly: the ownership check is structural, not a
// conditional a future edit could forget.
//
// It reads BOTH evaluation shapes. Evaluations are immutable and are never
// recomputed, so a student's older runs stay in the legacy shape permanently
// and the dashboard must keep understanding them — see stored-shape.ts.
import { prisma } from "@/lib/db";
import {
  getOrCreateProfile,
  getProfileWithRelations,
  getOwnedEvaluations,
} from "@/lib/ownership";
import {
  readStoredEvaluation,
  headlineOf,
  type StoredShape,
} from "@/lib/evaluation/stored-shape";
import { readStanding, type StandingReading } from "./standing";
import { REVIEW_LABEL, RETIRED_REVIEW_LABEL } from "@/lib/evaluation/history";
import {
  findProfileGaps,
  isEvaluationStale,
  scoreMovement,
  type ProfileGap,
  type ScoreMove,
} from "./summary";

/**
 * How many next steps the dashboard shows before linking onward.
 *
 * Five rather than three, because the list is now a union: this fortnight's
 * action plus every open commitment. Three was enough when it held one
 * evaluation's ranked actions and is not enough to show a student everything
 * they are actually on the hook for.
 */
export const NEXT_STEP_LIMIT = 5;

/** One thing to do next, from whichever shape produced it. */
export type NextStep = {
  title: string;
  detail: string;
  /** e.g. "low effort · high impact · This term", or a due date. */
  meta: string | null;
  /** Set when this is a Commitment the student can accept or decline. */
  commitmentId?: string;
  status?: string;
};

/**
 * How far back to look for a percentile reading to carry forward.
 *
 * Bounded because every candidate costs a JSON parse and a schema validation,
 * and a student who has not scored in twenty runs is not owed a number from
 * two years ago anyway.
 */
const SCORE_LOOKBACK = 12;

/**
 * The most recent percentile scores the student actually has, shown when the
 * newest run did not produce any.
 *
 * A Deep Review measures in bands, so the moment one becomes the newest run the
 * percentile block stops rendering — and the scores vanish from the dashboard
 * along with the US/UK split, which is the one reading this app exists to keep
 * separate. Nothing about those numbers stopped being true; they were just no
 * longer being looked for.
 *
 * This carries them forward AS WHAT THEY ARE: dated, attributed to the run that
 * produced them, and never placed alongside a band as though the two were a
 * matched pair. The rule in standing.ts is untouched — no band is converted
 * into a score here, and no score into a band.
 */
export type CarriedScores = {
  /** The evaluation these came from, so the student can go read it. */
  id: string;
  createdAt: Date;
  reading: Extract<StandingReading, { kind: "percentile" }>;
  /** Movement against the previous PERCENTILE run, skipping any tier runs between. */
  overallMove: ScoreMove;
  gradeRelativeMove: ScoreMove;
};

export type DashboardData = {
  studentLabelSource: Awaited<ReturnType<typeof getOrCreateProfile>>;
  gaps: ProfileGap[];
  latest: {
    id: string;
    createdAt: Date;
    headline: string;
    standing: StandingReading;
    /** "Deep Review", "Check-In", or the legacy "Evaluation". */
    label: string;
    nextSteps: NextStep[];
    moreCount: number;
  } | null;
  /** Only meaningful for two legacy runs — see scoreMovement. */
  overallMove: ScoreMove;
  gradeRelativeMove: ScoreMove;
  /** Set only when the newest run is NOT a percentile one. Never both. */
  carriedScores: CarriedScores | null;
  stale: boolean;
  evaluationCount: number;
};

export async function loadDashboard(): Promise<DashboardData> {
  const [profile, withRelations, evaluations] = await Promise.all([
    getOrCreateProfile(),
    getProfileWithRelations(),
    getOwnedEvaluations(),
  ]);

  const gaps = findProfileGaps({
    gradeLevel: profile.gradeLevel,
    schoolContext: profile.schoolContext,
    targets: withRelations.targetSchools.map((t) => ({
      name: t.name,
      country: t.country,
      course: t.course,
    })),
    resumeItemCount: withRelations.resumeItems.length,
  });

  // Samples are a placeholder produced without an API key, and a no-change
  // check-in has no narrative. Neither is "where you stand".
  const real = evaluations.filter(
    (e) => e.status === "completed" && !e.isSample && e.materialChange !== false,
  );
  const [newest, previous] = real;

  const shape = newest ? readStoredEvaluation(newest) : { kind: "none" as const };
  const previousShape = previous
    ? readStoredEvaluation(previous)
    : { kind: "none" as const };

  // Open commitments are loaded ALWAYS, not only when a deep review happens to
  // be the newest run.
  //
  // They are state, not the output of one evaluation: a commitment a student
  // took on three weeks ago is still owed today, and gating them on the latest
  // shape meant the moment a check-in arrived — which is every fortnight, by
  // design — every commitment silently vanished from "do this next". The tier
  // that exists to keep the follow-through loop alive was the thing switching
  // it off.
  const commitments = await prisma.commitment.findMany({
    where: {
      profileId: profile.id,
      status: { in: ["PROPOSED", "ACCEPTED", "IN_PROGRESS"] },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    take: 6,
  });

  const nextSteps = buildNextSteps(shape, commitments);

  // The two most recent runs that produced percentiles, whatever ran in
  // between. Tier runs are skipped rather than treated as a gap: a Deep Review
  // arriving between two evaluations did not change either score, so counting
  // it would break a comparison that is still perfectly valid.
  const scoredRuns: { row: (typeof real)[number]; shape: StoredShape }[] = [];
  for (const row of real.slice(0, SCORE_LOOKBACK)) {
    const s = row === newest ? shape : readStoredEvaluation(row);
    if (s.kind === "legacy") scoredRuns.push({ row, shape: s });
    if (scoredRuns.length === 2) break;
  }

  const [scored, previousScored] = scoredRuns;
  const carriedScores =
    // Nothing to carry when the newest run already shows its own percentiles —
    // rendering both would print the same two numbers twice, once labelled
    // current and once labelled old.
    shape.kind === "legacy" || !scored
      ? null
      : {
          id: scored.row.id,
          createdAt: scored.row.createdAt,
          reading: readStanding(scored.shape, scored.row) as Extract<
            StandingReading,
            { kind: "percentile" }
          >,
          overallMove: movementFor(
            scored.shape,
            previousScored?.shape ?? { kind: "none" },
            scored.row,
            previousScored?.row,
            "overallScore",
          ),
          gradeRelativeMove: movementFor(
            scored.shape,
            previousScored?.shape ?? { kind: "none" },
            scored.row,
            previousScored?.row,
            "gradeRelativeScore",
          ),
        };

  return {
    studentLabelSource: profile,
    gaps,
    latest:
      newest && shape.kind !== "none"
        ? {
            id: newest.id,
            createdAt: newest.createdAt,
            headline: headlineOf(shape) ?? "",
            standing: readStanding(shape, newest),
            label: labelFor(shape.kind),
            nextSteps: nextSteps.slice(0, NEXT_STEP_LIMIT),
            moreCount: Math.max(0, nextSteps.length - NEXT_STEP_LIMIT),
          }
        : null,
    // Movement is only computed between two runs of the SAME shape. Percentiles
    // and bands measure different things, so subtracting across the boundary
    // would show a change that never happened to the student.
    overallMove: movementFor(shape, previousShape, newest, previous, "overallScore"),
    gradeRelativeMove: movementFor(
      shape,
      previousShape,
      newest,
      previous,
      "gradeRelativeScore",
    ),
    carriedScores,
    stale: isEvaluationStale(newest?.createdAt ?? null, withRelations.updatedAt),
    evaluationCount: real.length,
  };
}

function labelFor(kind: string): string {
  if (kind === "deep-review") return RETIRED_REVIEW_LABEL;
  if (kind === "check-in") return "Check-In";
  return REVIEW_LABEL;
}

function buildNextSteps(
  shape: ReturnType<typeof readStoredEvaluation>,
  commitments: { id: string; description: string; status: string; dueDate: Date | null }[],
): NextStep[] {
  const steps: NextStep[] = [];

  // This fortnight's single action comes FIRST when there is one. It is the
  // most immediate thing and the one with a deadline attached, and a check-in
  // that produced it two days ago outranks a commitment due in six weeks.
  if (shape.kind === "check-in") {
    steps.push({
      title: shape.result.actionThisFortnight,
      detail: shape.result.movement.driver ?? "",
      meta: "this fortnight",
    });
  }

  // Legacy actions, for a student who has never run a tier evaluation. Array
  // order IS the priority — the model is asked to rank these.
  if (shape.kind === "legacy") {
    for (const a of shape.result.actions) {
      steps.push({
        title: a.title,
        detail: a.detail,
        meta: `${a.effort} effort · ${a.impact} impact · ${a.timeframe}`,
      });
    }
  }

  // Then everything still outstanding, WHATEVER produced it. A commitment is
  // owed until it is resolved; which evaluation happens to be newest has no
  // bearing on that.
  for (const c of commitments) {
    steps.push({
      title: c.description,
      detail:
        c.status === "PROPOSED"
          ? "Proposed in your last review — accept it to start tracking, or decline."
          : "You committed to this.",
      meta: c.dueDate ? `by ${c.dueDate.toISOString().slice(0, 10)}` : null,
      commitmentId: c.id,
      status: c.status,
    });
  }

  return steps;
}

/**
 * Movement between two runs, or a reason there is none.
 *
 * Returns "first" whenever the two runs are not the same shape, which is not a
 * lie by omission: there genuinely is no comparison to make between a
 * percentile and a band, and the alternative is a number describing a change in
 * the instrument rather than in the student.
 */
function movementFor(
  shape: ReturnType<typeof readStoredEvaluation>,
  previousShape: ReturnType<typeof readStoredEvaluation>,
  newest: { promptVersion: string | null } | undefined,
  previous: { promptVersion: string | null } | undefined,
  key: "overallScore" | "gradeRelativeScore",
): ScoreMove {
  if (shape.kind !== "legacy" || previousShape.kind !== "legacy") {
    return { kind: "first" };
  }
  // `?? null` is load-bearing, not a type appeasement: gradeRelativeScore
  // arrived in prompt v3, so a run older than that genuinely has none. Null
  // makes scoreMovement report "first" — no comparison — where undefined would
  // have flowed into arithmetic and produced NaN.
  return scoreMovement(
    { score: shape.result[key] ?? null, promptVersion: newest?.promptVersion ?? null },
    {
      score: previousShape.result[key] ?? null,
      promptVersion: previous?.promptVersion ?? null,
    },
    key,
  );
}
