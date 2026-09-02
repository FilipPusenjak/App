// Deriving chart points for evaluations written before chartPointJson existed.
//
// MUST RUN TO COMPLETION BEFORE ANY NARRATIVE EXPIRES. An old row's numbers
// live only inside its narrative; once that is deleted they are gone, and the
// evaluation disappears from the student's chart forever. So the retention
// sweep refuses to run while any completed evaluation still lacks a point —
// see lib/evaluation/retention.ts, which checks this rather than trusting that
// somebody remembered to run the backfill.
//
// Idempotent and resumable: it only ever writes rows whose point is null, so
// running it twice is a no-op and running it after an interruption picks up
// where it stopped.
import { prisma } from "@/lib/db";
import { readStoredEvaluation } from "./stored-shape";
import { serializeChartPoint, toChartPoint } from "./chart-point";

export type BackfillResult = {
  scanned: number;
  written: number;
  /** Rows whose narrative could not be parsed — nothing to derive from. */
  unreadable: number;
};

/**
 * Fill in chart points for completed evaluations that lack one.
 *
 * Batched rather than one big query: a four-year account is small, but the
 * whole table across every account is not, and this runs against production.
 */
export async function backfillChartPoints(
  batchSize = 200,
): Promise<BackfillResult> {
  const result: BackfillResult = { scanned: 0, written: 0, unreadable: 0 };

  for (;;) {
    const rows = await prisma.evaluation.findMany({
      where: {
        chartPointJson: null,
        status: "completed",
        isSample: false,
        resultJson: { not: null },
      },
      select: {
        id: true,
        status: true,
        isSample: true,
        overallScore: true,
        resultJson: true,
        promptVersion: true,
      },
      take: batchSize,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      result.scanned += 1;
      const shape = readStoredEvaluation(row);
      if (shape.kind !== "legacy") {
        // Nothing derivable. Write a minimal point anyway when the column has a
        // score, so the row still plots — otherwise it would be skipped here on
        // every future pass and counted as unreadable forever.
        if (row.overallScore !== null) {
          await prisma.evaluation.update({
            where: { id: row.id },
            data: {
              chartPointJson: serializeChartPoint(
                toChartPoint(null, row.overallScore),
              ),
            },
          });
          result.written += 1;
        } else {
          result.unreadable += 1;
          // Marked so the loop cannot spin on it forever. An empty point is
          // distinguishable from a real one and plots nothing.
          await prisma.evaluation.update({
            where: { id: row.id },
            data: { chartPointJson: JSON.stringify({ v: 1, overall: null, narrative: null, schools: [] }) },
          });
        }
        continue;
      }

      const point = toChartPoint(shape.result, row.overallScore);
      await prisma.evaluation.update({
        where: { id: row.id },
        data: {
          chartPointJson:
            serializeChartPoint(point) ??
            JSON.stringify({ v: 1, overall: null, narrative: null, schools: [] }),
        },
      });
      result.written += 1;
    }
  }

  return result;
}

/**
 * How many evaluations still hold a narrative nothing has been derived from.
 *
 * The retention sweep's precondition, and it counts EXACTLY the set the
 * backfill above processes — `resultJson: { not: null }` included. That
 * condition is load-bearing rather than tidy:
 *
 * A completed evaluation can legitimately have no narrative at all. A check-in
 * that found no material change writes precisely that — no narrative, no model,
 * no cost. Counting those as "missing a chart point" would leave the number
 * permanently non-zero, and the sweep would refuse to run for the rest of the
 * application's life while quietly reporting a reason that sounded temporary.
 *
 * A row with no narrative also has nothing retention could take away, so it is
 * not something this precondition exists to protect.
 */
export async function countMissingChartPoints(): Promise<number> {
  return prisma.evaluation.count({
    where: {
      chartPointJson: null,
      status: "completed",
      isSample: false,
      resultJson: { not: null },
    },
  });
}
