// Turns saved evaluations into progress-over-time series.
//
// Sample evaluations are excluded: their score is a fixed placeholder, so
// plotting them would draw a trend line through a number that measures nothing.
// Failed evaluations are excluded for the same reason (no score at all).
import { parseStoredResult } from "@/lib/validation/evaluation";

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
  createdAt: Date;
};

const shortDate = (d: Date) =>
  d.toLocaleDateString("en-US", { day: "numeric", month: "short" });

export function buildProgress(evaluations: EvaluationRow[]): ProgressData {
  const points: ProgressPoint[] = [];

  // Oldest first.
  const usable = [...evaluations]
    .filter(
      (e) => e.status === "completed" && !e.isSample && e.overallScore != null,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const e of usable) {
    const result = parseStoredResult(e.resultJson);
    points.push({
      id: e.id,
      at: e.createdAt,
      label: shortDate(e.createdAt),
      overall: e.overallScore!,
      narrative: result?.narrativeCoherence.score ?? null,
      schools:
        result?.schoolFits.map((f) => ({
          name: f.schoolName,
          score: Math.round(f.fitScore),
        })) ?? [],
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
