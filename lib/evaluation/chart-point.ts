// The handful of numbers a progress chart needs, pulled out of the narrative.
//
// PURE — no database, no session. Derivation is a function of a parsed result,
// so the same code writes a new evaluation's point and backfills an old one,
// and both can be tested without standing anything up.
//
// WHY THIS EXISTS: the narrative is deleted on a retention schedule, and
// buildProgress read the per-school fits and the narrative-coherence score
// straight out of it. Expiring a narrative would therefore have quietly removed
// that evaluation from the chart — and the chart is the one screen whose whole
// job is showing four years of movement. The numbers have to outlive the prose
// they were extracted from.
import { z } from "zod";

/**
 * A chart point, versioned.
 *
 * `v` is here so a later change to what the chart plots can be detected rather
 * than guessed at: an old point missing a new field reads as absent, not zero.
 */
export const chartPointSchema = z.object({
  v: z.literal(1),
  /** The 0-100 headline. Also on its own column; kept here so a point is whole. */
  overall: z.number().int().min(0).max(100).nullable(),
  /** Narrative coherence, the second line on the chart. */
  narrative: z.number().int().min(0).max(100).nullable(),
  /** Per-school fit, in the order the evaluation listed them. */
  schools: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        score: z.number().int().min(0).max(100),
      }),
    )
    .max(60),
});

export type ChartPoint = z.infer<typeof chartPointSchema>;

/** The shape this derives from — the parts of a result the chart reads. */
export type ChartSource = {
  overallScore?: number | null;
  narrativeCoherence?: { score?: number | null } | null;
  schoolFits?: { schoolName: string; fitScore: number }[] | null;
};

/**
 * Derive a chart point from a parsed evaluation result.
 *
 * Rounds on the way in, because the chart rounds anyway and storing 71.4 would
 * make a stored point and a freshly-parsed one disagree in the last digit for
 * no reason.
 */
export function toChartPoint(
  result: ChartSource | null | undefined,
  overallScoreColumn: number | null,
): ChartPoint {
  const overall =
    overallScoreColumn ??
    (typeof result?.overallScore === "number"
      ? Math.round(result.overallScore)
      : null);

  const narrative =
    typeof result?.narrativeCoherence?.score === "number"
      ? Math.round(result.narrativeCoherence.score)
      : null;

  const schools = (result?.schoolFits ?? [])
    .filter((f) => typeof f?.fitScore === "number" && f.schoolName?.trim())
    .map((f) => ({
      name: f.schoolName.trim().slice(0, 200),
      score: clamp(Math.round(f.fitScore)),
    }));

  return { v: 1, overall: overall === null ? null : clamp(overall), narrative, schools };
}

/** Serialize for storage, or null when there is nothing worth plotting. */
export function serializeChartPoint(point: ChartPoint): string | null {
  // A point with no overall AND no schools plots nothing. Storing it would put
  // a row on the chart that renders as a gap.
  if (point.overall === null && point.schools.length === 0) return null;
  return JSON.stringify(point);
}

/** Parse a stored point back, or null when absent or unreadable. */
export function parseChartPoint(raw: string | null | undefined): ChartPoint | null {
  if (!raw) return null;
  try {
    const parsed = chartPointSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
