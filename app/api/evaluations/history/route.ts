// GET /api/evaluations/history
//
// The timeline behind the progress chart. Marks rubric-version boundaries so a
// methodology change reads as a methodology change rather than as the student's
// history being silently redrawn — evaluations are immutable and are never
// recomputed when the rubric moves, so without the marker a student would see
// an unexplained step in their own past.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getOwnedEvaluations } from "@/lib/ownership";
import { RUBRIC_VERSION } from "@/lib/readiness/score";
import { TIER_LABELS, type EvaluationType } from "@/lib/validation/tiers";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const evaluations = await getOwnedEvaluations();

  // Oldest first: a timeline reads forward, and boundary detection needs the
  // previous entry rather than the next one.
  const ordered = [...evaluations].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  let previousRubric: string | null = null;
  const points = ordered.map((e) => {
    const rubricChanged = previousRubric != null && e.rubricVersion !== previousRubric;
    const boundaryFrom = rubricChanged ? previousRubric : null;
    previousRubric = e.rubricVersion ?? previousRubric;

    return {
      id: e.id,
      at: e.createdAt.toISOString(),
      type: e.type as EvaluationType,
      // The user-facing name. Model ids never leave the server.
      label: TIER_LABELS[e.type as EvaluationType] ?? e.type,
      status: e.status,
      materialChange: e.materialChange,
      thresholdBand: bandOf(e.thresholdSnapshotJson),
      differentiationBand: bandOf(e.differentiationSnapshotJson),
      paceStatus: e.paceStatus,
      rubricVersion: e.rubricVersion,
      /**
       * Set on the FIRST evaluation scored under a new rubric. The chart draws
       * a divider here and says why, instead of letting the reader interpret a
       * scale change as movement.
       */
      rubricBoundary: rubricChanged
        ? {
            from: boundaryFrom,
            to: e.rubricVersion,
            note: "How readiness is measured changed here. Points on either side are not directly comparable.",
          }
        : null,
    };
  });

  return NextResponse.json({
    currentRubricVersion: RUBRIC_VERSION,
    points,
  });
}

function bandOf(snapshotJson: string | null): string | null {
  if (!snapshotJson) return null;
  try {
    const parsed = JSON.parse(snapshotJson) as { band?: unknown };
    return typeof parsed.band === "string" ? parsed.band : null;
  } catch {
    return null;
  }
}
