// The frozen input for a projection: the profile as it stands, plus the plans,
// plus the scores the projection is measured against.
//
// Stored on the Projection row for the same reason evaluations store theirs — a
// projection read weeks later should still show what was actually assessed,
// including which plans existed at the time.
import { buildSnapshot, type EvaluationSnapshot } from "./snapshot";

export type ProjectionSnapshot = {
  capturedAt: string;
  /** The real profile, exactly as an evaluation would see it. */
  profile: EvaluationSnapshot;
  /** Scores from the base evaluation, so the projection starts from a fact. */
  baseline: {
    evaluationId: string | null;
    capturedAt: string | null;
    overallScore: number | null;
    /** Per-system readiness, keyed by rubric id. */
    systemReadiness: Record<string, number>;
  };
  plannedItems: {
    /** Short stable handle ("P1", "P2") the model keys its assessments to. */
    ref: string;
    id: string;
    type: string;
    title: string;
    org: string | null;
    description: string | null;
    targetDate: string | null;
    hoursPerWeek: number | null;
  }[];
};

type PlannedItemLike = {
  id: string;
  type: string;
  title: string;
  org: string | null;
  description: string | null;
  targetDate: Date | null;
  hoursPerWeek: number | null;
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function buildProjectionSnapshot(
  profile: Parameters<typeof buildSnapshot>[0],
  countryOfOrigin: string | null,
  plannedItems: PlannedItemLike[],
  baseline: ProjectionSnapshot["baseline"],
): ProjectionSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    profile: buildSnapshot(profile, countryOfOrigin),
    baseline,
    plannedItems: plannedItems.map((p, index) => ({
      ref: `P${index + 1}`,
      id: p.id,
      type: p.type,
      title: p.title,
      org: p.org,
      description: p.description,
      targetDate: iso(p.targetDate),
      hoursPerWeek: p.hoursPerWeek,
    })),
  };
}
