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
//
// TWO PASSES, ONE PER TIER. Free accounts keep prose for a month and paying ones
// for an application cycle, so the sweep runs twice over complementary sets of
// users rather than once over everything.
//
// Who counts as paying is decided by the billing rules themselves
// (userIdsWithPaidAccess), not by a status column in the WHERE clause. The
// difference matters: a cancelled subscription still grants its plan until the
// period it paid for runs out, and past_due keeps access while Stripe retries.
// Expressed as SQL, each of those cases would delete a paying customer's data
// early — the worst thing this file can do.
import { prisma } from "@/lib/db";
import { userIdsWithPaidAccess } from "@/lib/billing/subscription";
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
      /** Reported per tier, because one number cannot say whether a sweep that
       *  cleared a lot did so on free accounts or on paying ones. */
      free: { snapshotsCleared: number; resultsCleared: number };
      paid: { snapshotsCleared: number; resultsCleared: number };
      paidAccounts: number;
      policy: { free: RetentionPolicy; paid: RetentionPolicy };
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

  const policy = {
    free: getRetentionPolicy("free"),
    paid: getRetentionPolicy("paid"),
  };

  // Who is paying RIGHT NOW, resolved once and applied to both passes. Read
  // before any deletion so a subscription that lapses mid-sweep cannot cause
  // the two passes to disagree about the same account.
  const paidUserIds = [...(await userIdsWithPaidAccess(now))];

  // The two passes are each other's complement: `in` for payers, `notIn` for
  // everyone else. An account with no subscription row is free by definition
  // and is caught by the second — which is also why an empty payer list is
  // correct rather than a bug, `notIn: []` matching every row.
  const paid = await clearExpired(policy.paid, now, {
    profile: { userId: { in: paidUserIds } },
  });
  const free = await clearExpired(policy.free, now, {
    profile: { userId: { notIn: paidUserIds } },
  });

  return {
    ran: true,
    snapshotsCleared: free.snapshotsCleared + paid.snapshotsCleared,
    resultsCleared: free.resultsCleared + paid.resultsCleared,
    free,
    paid,
    paidAccounts: paidUserIds.length,
    policy,
  };
}

/** One tier's worth of deletion, over both row types that carry prose. */
async function clearExpired(
  policy: RetentionPolicy,
  now: Date,
  scope: { profile: { userId: { in: string[] } | { notIn: string[] } } },
): Promise<{ snapshotsCleared: number; resultsCleared: number }> {
  const snapshotCutoff = cutoffFor(policy.inputSnapshotDays, now);
  const resultCutoff = cutoffFor(policy.resultDays, now);

  let snapshotsCleared = 0;
  let resultsCleared = 0;

  if (snapshotCutoff) {
    // Evaluations first, then projections — both carry a raw profile snapshot
    // and both are equally sensitive.
    const [a, b] = await Promise.all([
      prisma.evaluation.updateMany({
        where: {
          ...scope,
          createdAt: { lt: snapshotCutoff },
          inputSnapshotJson: { not: null },
        },
        data: { inputSnapshotJson: null },
      }),
      prisma.projection.updateMany({
        where: {
          ...scope,
          createdAt: { lt: snapshotCutoff },
          inputSnapshotJson: { not: null },
        },
        data: { inputSnapshotJson: null },
      }),
    ]);
    snapshotsCleared = a.count + b.count;
  }

  if (resultCutoff) {
    const [a, b] = await Promise.all([
      prisma.evaluation.updateMany({
        where: {
          ...scope,
          createdAt: { lt: resultCutoff },
          resultJson: { not: null },
        },
        data: { resultJson: null },
      }),
      prisma.projection.updateMany({
        where: {
          ...scope,
          createdAt: { lt: resultCutoff },
          resultJson: { not: null },
        },
        data: { resultJson: null },
      }),
    ]);
    resultsCleared = a.count + b.count;
  }

  return { snapshotsCleared, resultsCleared };
}
