// Applying the retention policy — the part that actually deletes.
//
// The rule lives in retention.ts, free of database imports so it can be tested
// directly. This is the part that reaches for data, and it is the only code in
// the app that destroys something a user might still want.
//
// TWO REFUSALS, both deliberate:
//
//   IT WILL NOT RUN while any completed evaluation still lacks a chart point.
//   An un-backfilled row's numbers exist only inside its narrative; deleting
//   that narrative removes the evaluation from the student's four-year chart
//   permanently. Checked rather than assumed, because "run the backfill first"
//   is exactly the instruction someone forgets once.
//
//   IT NEVER TOUCHES A SCORE. It nulls two text columns and nothing else. Not
//   overallScore, not chartPointJson, not the threshold snapshots. A sweep that
//   could reach those is one bad WHERE clause away from erasing the history the
//   product exists to show.
import { prisma } from "@/lib/db";
import { countMissingChartPoints } from "./backfill-chart-points";
import { cutoffFor, getRetentionPolicy, type RetentionPolicy } from "./retention";

export type SweepResult =
  | {
      ran: false;
      reason: "backfill-incomplete";
      /** How many rows still need a chart point before this is safe. */
      missingChartPoints: number;
    }
  | {
      ran: true;
      snapshotsCleared: number;
      resultsCleared: number;
      policy: RetentionPolicy;
    };

/**
 * Delete expired prose.
 *
 * Two narrow updateMany calls rather than a read-then-write loop: the database
 * decides what is expired from its own clock, and there is no window in which a
 * row could be selected and then written after something else changed it.
 */
export async function sweepExpiredProse(
  now: Date = new Date(),
): Promise<SweepResult> {
  const missing = await countMissingChartPoints();
  if (missing > 0) {
    return { ran: false, reason: "backfill-incomplete", missingChartPoints: missing };
  }

  const policy = getRetentionPolicy();
  const snapshotCutoff = cutoffFor(policy.inputSnapshotDays, now);
  const resultCutoff = cutoffFor(policy.resultDays, now);

  let snapshotsCleared = 0;
  let resultsCleared = 0;

  if (snapshotCutoff) {
    // Evaluations first, then projections — both carry a raw profile snapshot
    // and both are equally sensitive.
    const [a, b] = await Promise.all([
      prisma.evaluation.updateMany({
        where: { createdAt: { lt: snapshotCutoff }, inputSnapshotJson: { not: null } },
        data: { inputSnapshotJson: null },
      }),
      prisma.projection.updateMany({
        where: { createdAt: { lt: snapshotCutoff }, inputSnapshotJson: { not: null } },
        data: { inputSnapshotJson: null },
      }),
    ]);
    snapshotsCleared = a.count + b.count;
  }

  if (resultCutoff) {
    const [a, b] = await Promise.all([
      prisma.evaluation.updateMany({
        where: { createdAt: { lt: resultCutoff }, resultJson: { not: null } },
        data: { resultJson: null },
      }),
      prisma.projection.updateMany({
        where: { createdAt: { lt: resultCutoff }, resultJson: { not: null } },
        data: { resultJson: null },
      }),
    ]);
    resultsCleared = a.count + b.count;
  }

  return { ran: true, snapshotsCleared, resultsCleared, policy };
}
