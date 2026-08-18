// Turns saved evaluations into progress-over-time series.
//
// Sample evaluations are excluded: their score is a fixed placeholder, so
// plotting them would draw a trend line through a number that measures nothing.
// Failed evaluations are excluded for the same reason (no score at all).
//
// ONLY legacy (percentile) evaluations are plotted, and the filter is on the
// stored SHAPE rather than on "does this row happen to have a number in the
// overallScore column". Those two tests agree today — deep reviews and
// check-ins leave that column null — but they agree by coincidence, and this
// chart is exactly the place where the coincidence breaking would be silent:
// one tier that starts writing any number to that column would get a line
// drawn from a percentile to it, which reads as the student moving when only
// the instrument changed. See comparableShapes in stored-shape.ts.
import { readStoredEvaluation } from "@/lib/evaluation/stored-shape";

export type ProgressPoint = {
  id: string;
  at: Date;
  /** Short axis label, e.g. "3 Jul". */
  label: string;
  overall: number;
  narrative: number | null;
  schools: { name: string; score: number }[];
};

export type ProgressData = {
  /** Chronological, oldest first — the direction a trend is read in. */
  points: ProgressPoint[];
  /** Distinct target schools seen across all points, first-seen order. */
  schools: string[];
};

type EvaluationRow = {
  id: string;
  status: string;
  isSample: boolean;
  overallScore: number | null;
  resultJson: string | null;
  promptVersion: string | null;
  createdAt: Date;
};

const shortDate = (d: Date) =>
  d.toLocaleDateString("en-US", { day: "numeric", month: "short" });

export function buildProgress(evaluations: EvaluationRow[]): ProgressData {
  const points: ProgressPoint[] = [];

  // Oldest first.
  const usable = [...evaluations]
    .filter((e) => e.status === "completed" && !e.isSample)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const e of usable) {
    const shape = readStoredEvaluation(e);
    if (shape.kind !== "legacy") continue;
    // The column and the parsed narrative are two records of the same number.
    // Prefer the column (it is what every other percentile surface reads) and
    // fall back to the narrative, but skip the point entirely rather than plot
    // a zero if neither has one.
    const overall = e.overallScore ?? shape.result.overallScore;
    if (overall == null) continue;
    points.push({
      id: e.id,
      at: e.createdAt,
      label: shortDate(e.createdAt),
      overall,
      narrative: shape.result.narrativeCoherence.score ?? null,
      schools: shape.result.schoolFits.map((f) => ({
        name: f.schoolName,
        score: Math.round(f.fitScore),
      })),
    });
  }

  const schools: string[] = [];
  for (const p of points) {
    for (const s of p.schools) {
      if (!schools.includes(s.name)) schools.push(s.name);
    }
  }

  return { points, schools };
}

/** The series for one school, with gaps where it wasn't in that evaluation. */
export function schoolSeries(
  data: ProgressData,
  school: string,
): { label: string; value: number | null }[] {
  return data.points.map((p) => ({
    label: p.label,
    value: p.schools.find((s) => s.name === school)?.score ?? null,
  }));
}

/** Change from the previous evaluation, or null when there's nothing to compare. */
export function deltaFromPrevious(
  data: ProgressData,
  index: number,
): number | null {
  if (index <= 0 || index >= data.points.length) return null;
  return data.points[index]!.overall - data.points[index - 1]!.overall;
}
