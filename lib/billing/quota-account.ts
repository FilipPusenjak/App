// Applying the quota to a real account.
//
// The rule lives in quota.ts, free of database imports. This is the part that
// reaches for data: when did this account last run each thing, what plan are
// they on, and what credits do they hold.
import { prisma } from "@/lib/db";
import { effectivePlanFor } from "./subscription";
import { consumeCredit, creditsFor } from "./codes";
import {
  RUN_KINDS,
  checkQuota,
  quotaFor,
  refundsFailedRun,
  standingFor,
  type QuotaDecision,
  type QuotaStanding,
  type RunKind,
} from "./quota";

/**
 * When this account last ran each kind.
 *
 * Scoped by userId through the profile relation, like every other read here.
 * Sample runs are excluded — they call no model and cost nothing, so letting
 * one start a quota window would punish somebody for looking at the demo.
 */
export async function lastRunAtByKind(
  userId: string,
): Promise<Record<RunKind, Date | null>> {
  // quotaRefunded rows are skipped for the same reason samples are: they cost
  // the account nothing, so they must not start a window. A refunded failure
  // that still pushed out the next-available date would be a refund in name
  // only — see refundFailedRun below.
  const base = { profile: { userId }, isSample: false, quotaRefunded: false } as const;

  const [deepReview, checkIn, projection] = await Promise.all([
    prisma.evaluation.findFirst({
      // A Deep Review is anything that is not a check-in. Matched on the
      // absence of the check-in prompt prefix rather than on type, because
      // legacy rows predate the type column.
      where: { ...base, NOT: { promptVersion: { startsWith: "check-in/" } } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.evaluation.findFirst({
      where: { ...base, promptVersion: { startsWith: "check-in/" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.projection.findFirst({
      where: base,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    DEEP_REVIEW: deepReview?.createdAt ?? null,
    CHECK_IN: checkIn?.createdAt ?? null,
    PROJECTION: projection?.createdAt ?? null,
  };
}

/**
 * May this account run this now — and if it needs a credit, spend one.
 *
 * SPENDS THE CREDIT HERE, not at the call site. A route that had to remember to
 * consume it after a successful run would eventually forget, and the failure
 * mode is a credit that works forever.
 *
 * The credit is spent BEFORE the run rather than after. That means a run which
 * then fails for some other reason has still cost the credit — deliberately the
 * safer direction, since the alternative is a window in which a run is in
 * flight and the credit still looks available.
 */
export async function authorizeRun(input: {
  userId: string;
  kind: RunKind;
  now?: Date;
}): Promise<QuotaDecision> {
  const now = input.now ?? new Date();
  const [plan, lastRuns, credits] = await Promise.all([
    effectivePlanFor(input.userId, "STUDENT", now),
    lastRunAtByKind(input.userId),
    creditsFor(input.userId),
  ]);

  const decision = checkQuota({
    kind: input.kind,
    lastRunAt: lastRuns[input.kind],
    policy: quotaFor(plan),
    creditsAvailable: credits[input.kind],
    now,
  });

  if (decision.allowed && decision.usingCredit) {
    const spent = await consumeCredit(input.userId, input.kind);
    if (!spent) {
      // Another request took the last credit between the read and the write.
      // Re-decide with none rather than letting this one through for free.
      return checkQuota({
        kind: input.kind,
        lastRunAt: lastRuns[input.kind],
        policy: quotaFor(plan),
        creditsAvailable: 0,
        now,
      });
    }
  }

  return decision;
}

/**
 * The status of the run before this one, for the same account and kind.
 *
 * Deep Reviews and Check-Ins share the Evaluation table and are told apart the
 * same way lastRunAtByKind tells them apart — by the check-in prompt prefix
 * rather than by `type`, because rows written before the type column exists
 * still have to be classified correctly.
 */
async function previousRunStatus(
  userId: string,
  kind: RunKind,
  excludeRunId: string,
): Promise<string | null> {
  const base = {
    profile: { userId },
    isSample: false,
    id: { not: excludeRunId },
  } as const;
  const newest = { orderBy: { createdAt: "desc" }, select: { status: true } } as const;

  if (kind === "PROJECTION") {
    const row = await prisma.projection.findFirst({ where: base, ...newest });
    return row?.status ?? null;
  }

  const row = await prisma.evaluation.findFirst({
    where: {
      ...base,
      ...(kind === "CHECK_IN"
        ? { promptVersion: { startsWith: "check-in/" } }
        : { NOT: { promptVersion: { startsWith: "check-in/" } } }),
    },
    ...newest,
  });
  return row?.status ?? null;
}

/**
 * Give a failed run back — the credit AND the interval — unless it is the
 * second failure in a row.
 *
 * The decision itself is refundsFailedRun in quota.ts, which is where the
 * reasoning lives; this is the part that reaches for the data and writes.
 *
 * Both halves happen in ONE transaction. Returning the credit without marking
 * the row would leave the interval still charged, which on Plus is the half
 * that actually blocks the retry — the student would be told to wait a month
 * for a run they were just refunded.
 *
 * NEVER THROWS. It is called from an error path, and a failure to refund must
 * not replace the message the student was about to be given with a second,
 * more confusing one. A refund that did not happen is recoverable by hand; a
 * 500 swallowing the real error is not.
 */
export async function refundFailedRun(input: {
  userId: string;
  kind: RunKind;
  /** The failed row, so it can be excluded from "what came before" and marked. */
  runId: string;
  /** Whether authorizeRun spent a credit on this run — only then is one owed. */
  usingCredit: boolean;
}): Promise<boolean> {
  try {
    const previous = await previousRunStatus(input.userId, input.kind, input.runId);
    if (!refundsFailedRun(previous)) return false;

    await prisma.$transaction(async (tx) => {
      if (input.usingCredit) {
        // updateMany rather than update: an account that redeemed no code has
        // no RunCredit row at all, and this must not throw on the error path.
        await tx.runCredit.updateMany({
          where: { userId: input.userId, kind: input.kind },
          data: { remaining: { increment: 1 } },
        });
      }
      if (input.kind === "PROJECTION") {
        await tx.projection.update({
          where: { id: input.runId },
          data: { quotaRefunded: true },
        });
      } else {
        await tx.evaluation.update({
          where: { id: input.runId },
          data: { quotaRefunded: true },
        });
      }
    });
    return true;
  } catch (error) {
    console.error("Could not refund a failed run:", error);
    return false;
  }
}

/** Everything the plan page shows about quotas. */
export async function quotaStandings(
  userId: string,
  now: Date = new Date(),
): Promise<QuotaStanding[]> {
  const [plan, lastRuns, credits] = await Promise.all([
    effectivePlanFor(userId, "STUDENT", now),
    lastRunAtByKind(userId),
    creditsFor(userId),
  ]);
  const policy = quotaFor(plan);

  return RUN_KINDS.map((kind) =>
    standingFor({
      kind,
      lastRunAt: lastRuns[kind],
      policy,
      credits: credits[kind],
      now,
    }),
  );
}
