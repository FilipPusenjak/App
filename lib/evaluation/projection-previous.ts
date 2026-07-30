// Feeding the previous projection back into the next one.
//
// Same problem, same fix as evaluations: a student runs a projection, tweaks a
// plan, runs it again, and compares. If the numbers move for reasons unrelated
// to what they changed, the comparison is worthless — which is exactly what was
// reported. So each projection is told what the last one said and has to
// account for any difference.
import { prisma } from "@/lib/db";
import { parseStoredProjection } from "@/lib/validation/projection";
import type { ProjectionSnapshot } from "./projection-snapshot";

export type PreviousProjection = {
  capturedAt: string;
  /** Plan titles as they were, so the model can see what the student changed. */
  planTitles: string[];
  /** Previous projected readiness per rubric id. */
  projectedByRubric: Record<string, number>;
  /** Previous worthDoing verdict per plan title, so ratings stay stable too. */
  worthByPlanTitle: Record<string, string>;
  addedPlans: string[];
  removedPlans: string[];
  /** True when the plan list is identical — numbers should then be identical. */
  plansUnchanged: boolean;
};

/**
 * Load the most recent real projection for this profile and diff its plans
 * against the current ones.
 *
 * Scoped by profileId, which callers only get from the ownership helpers.
 * Samples are skipped (their numbers are placeholders), and anything
 * unreadable yields null rather than throwing — a failed comparison must never
 * break a run.
 */
export async function buildPreviousProjectionContext(
  profileId: string,
  current: ProjectionSnapshot,
): Promise<PreviousProjection | null> {
  const previous = await prisma.projection.findFirst({
    where: { profileId, status: "completed", isSample: false },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, inputSnapshotJson: true, resultJson: true },
  });

  if (!previous?.inputSnapshotJson) return null;

  let previousSnapshot: ProjectionSnapshot;
  try {
    previousSnapshot = JSON.parse(
      previous.inputSnapshotJson,
    ) as ProjectionSnapshot;
    if (!Array.isArray(previousSnapshot.plannedItems)) return null;
  } catch {
    return null;
  }

  const result = parseStoredProjection(previous.resultJson);
  if (!result) return null;

  const previousTitles = previousSnapshot.plannedItems.map((p) => p.title);
  const currentTitles = current.plannedItems.map((p) => p.title);
  const previousSet = new Set(previousTitles);
  const currentSet = new Set(currentTitles);

  const projectedByRubric: Record<string, number> = {};
  for (const sys of result.systemProjections) {
    projectedByRubric[sys.rubricId] = Math.round(sys.projectedReadiness);
  }

  const worthByPlanTitle: Record<string, string> = {};
  for (const plan of result.planAssessments) {
    worthByPlanTitle[plan.planTitle] = plan.worthDoing;
  }

  const addedPlans = currentTitles.filter((t) => !previousSet.has(t));
  const removedPlans = previousTitles.filter((t) => !currentSet.has(t));

  return {
    capturedAt: previousSnapshot.capturedAt,
    planTitles: previousTitles,
    projectedByRubric,
    worthByPlanTitle,
    addedPlans,
    removedPlans,
    plansUnchanged: addedPlans.length === 0 && removedPlans.length === 0,
  };
}
