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
import {
  cutoffFor,
  getRetentionPolicy,
  grandfatheredBefore,
  LEGACY_POLICY,
  type RetentionPolicy,
} from "./retention";

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
      /** Rows predating the tier split. Their resultsCleared is always 0 —
       *  their narratives are kept indefinitely — so a non-zero value here is
       *  the signal that the grandfather clause has stopped working. */
      legacy: { snapshotsCleared: number; resultsCleared: number };
      paidAccounts: number;
      grandfatheredBefore: Date;
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

  // Who is paying RIGHT NOW, resolved once and applied to every pass. Read
  // before any deletion so a subscription that lapses mid-sweep cannot cause
  // two passes to disagree about the same account.
  const paidUserIds = [...(await userIdsWithPaidAccess(now))];

  // Written before the tiers existed, on the old promise. Swept on the legacy
  // policy — snapshot still goes at 60 days, narrative never — and split off
  // FIRST so neither tier pass can reach it.
  const boundary = grandfatheredBefore();
  const written = { createdAt: { gte: boundary } };
  const legacy = await clearExpired(LEGACY_POLICY, now, [
    { createdAt: { lt: boundary } },
  ]);

  // The two tier passes are each other's complement: `in` for payers, `notIn`
  // for everyone else. An account with no subscription row is free by
  // definition and is caught by the second — which is also why an empty payer
  // list is correct rather than a bug, `notIn: []` matching every row.
  const paid = await clearExpired(policy.paid, now, [
    written,
    { profile: { userId: { in: paidUserIds } } },
  ]);
  const free = await clearExpired(policy.free, now, [
    written,
    { profile: { userId: { notIn: paidUserIds } } },
  ]);

  return {
    ran: true,
    snapshotsCleared:
      free.snapshotsCleared + paid.snapshotsCleared + legacy.snapshotsCleared,
    resultsCleared:
      free.resultsCleared + paid.resultsCleared + legacy.resultsCleared,
    free,
    paid,
    legacy,
    paidAccounts: paidUserIds.length,
    grandfatheredBefore: boundary,
    policy,
  };
}

/**
 * One policy's worth of deletion, over both row types that carry prose.
 *
 * `scope` is a list of conditions ANDed together rather than one object,
 * because the caller and this function both constrain createdAt — the caller
 * to split old rows from new, this function to pick the expired ones — and two
 * bounds on one field cannot be expressed by merging objects.
 */
async function clearExpired(
  policy: RetentionPolicy,
  now: Date,
  scope: Record<string, unknown>[],
): Promise<{ snapshotsCleared: number; resultsCleared: number }> {
  const snapshotCutoff = cutoffFor(policy.inputSnapshotDays, now);
  const resultCutoff = cutoffFor(policy.resultDays, now);

  let snapshotsCleared = 0;
  let resultsCleared = 0;

  if (snapshotCutoff) {
    // Evaluations first, then projections — both carry a raw profile snapshot
    // and both are equally sensitive.
    const where = {
      AND: [
        ...scope,
        { createdAt: { lt: snapshotCutoff } },
        { inputSnapshotJson: { not: null } },
      ],
    };
    const [a, b] = await Promise.all([
      prisma.evaluation.updateMany({ where, data: { inputSnapshotJson: null } }),
      prisma.projection.updateMany({ where, data: { inputSnapshotJson: null } }),
    ]);
    snapshotsCleared = a.count + b.count;
  }

  if (resultCutoff) {
    const where = {
      AND: [
        ...scope,
        { createdAt: { lt: resultCutoff } },
        { resultJson: { not: null } },
      ],
    };
    const [a, b] = await Promise.all([
      prisma.evaluation.updateMany({ where, data: { resultJson: null } }),
      prisma.projection.updateMany({ where, data: { resultJson: null } }),
    ]);
    resultsCleared = a.count + b.count;
  }

  return { snapshotsCleared, resultsCleared };
}
