// Everything the dashboard shows, loaded for the signed-in user only.
//
// Every read here goes through lib/ownership, which resolves the active
// profile from the authenticated session and never from anything a client
// sends. That is the whole reason this file exists rather than the page
// querying Prisma directly: the ownership check is structural, not a
// conditional a future edit could forget.
import { getOrCreateProfile, getProfileWithRelations, getOwnedEvaluations } from "@/lib/ownership";
import { evaluationResultSchema, type EvaluationResult } from "@/lib/validation/evaluation";
import { findProfileGaps, isEvaluationStale, scoreMovement, type ProfileGap, type ScoreMove } from "./summary";

export type DashboardData = {
  studentLabelSource: Awaited<ReturnType<typeof getOrCreateProfile>>;
  gaps: ProfileGap[];
  /** Null until a real evaluation has completed. */
  latest: {
    id: string;
    createdAt: Date;
    isSample: boolean;
    headline: string;
    overallScore: number | null;
    gradeRelativeScore: number | null;
    /** Prioritized; array order IS the priority, highest first. */
    actions: EvaluationResult["actions"];
    systemScores: EvaluationResult["systemScores"];
  } | null;
  overallMove: ScoreMove;
  gradeRelativeMove: ScoreMove;
  /** True when the profile has changed since the newest evaluation ran. */
  stale: boolean;
  evaluationCount: number;
};

function parseResult(json: string | null): EvaluationResult | null {
  if (!json) return null;
  try {
    const parsed = evaluationResultSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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

  // Samples are a placeholder produced without an API key. Treating one as a
  // result would put a hardcoded score on the dashboard as though a model had
  // judged this student.
  const real = evaluations.filter((e) => e.status === "completed" && !e.isSample);
  const [newest, previous] = real;

  const result = newest ? parseResult(newest.resultJson) : null;

  return {
    studentLabelSource: profile,
    gaps,
    latest:
      newest && result
        ? {
            id: newest.id,
            createdAt: newest.createdAt,
            isSample: newest.isSample,
            headline: result.headline,
            overallScore: result.overallScore,
            gradeRelativeScore: result.gradeRelativeScore,
            actions: result.actions,
            systemScores: result.systemScores,
          }
        : null,
    overallMove: scoreMovement(
      { score: result?.overallScore ?? null, promptVersion: newest?.promptVersion ?? null },
      previous
        ? {
            score: parseResult(previous.resultJson)?.overallScore ?? null,
            promptVersion: previous.promptVersion,
          }
        : null,
      "overallScore",
    ),
    gradeRelativeMove: scoreMovement(
      {
        score: result?.gradeRelativeScore ?? null,
        promptVersion: newest?.promptVersion ?? null,
      },
      previous
        ? {
            score: parseResult(previous.resultJson)?.gradeRelativeScore ?? null,
            promptVersion: previous.promptVersion,
          }
        : null,
      "gradeRelativeScore",
    ),
    stale: isEvaluationStale(newest?.createdAt ?? null, withRelations.updatedAt),
    evaluationCount: real.length,
  };
}
