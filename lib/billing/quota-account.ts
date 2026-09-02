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
  const base = { profile: { userId }, isSample: false } as const;

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
