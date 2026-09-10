// How many students this counselor's plan covers, and where they stand in it.
//
// MIRRORS lib/testprep/entitlement.ts deliberately, including the merge rule,
// because the failure it prevents is the same one: a purchased band DERIVES the
// ceiling rather than being copied onto the account, so there is no sync step to
// go wrong and a band that lapses reverts on its own instead of leaving a
// paid-for ceiling behind.
//
// The stored caseloadLimit stays the FLOOR. Every counselor account that exists
// today was set up by hand with a limit and no subscription, and a merge that
// took the plan alone would drop all of them to zero the moment this shipped.
//
// WHERE IT DIFFERS FROM THE TUTOR SIDE, and it is worth being explicit because
// the two files otherwise read the same: going over a tutor's band is only ever
// a sentence on a screen, while the counselor routes genuinely refuse — no new
// links, no new prep, over the limit. That difference is not introduced here; it
// is what app/api/counselor/links and .../prep already did. What changes is that
// the refusal now has an answer, because before this there was no plan to buy.
import { prisma } from "@/lib/db";
import { effectivePlanFor } from "@/lib/billing/subscription";
import { counselorBandFor, type Plan } from "@/lib/billing/plans";

export type CounselorStanding = {
  /** ACTIVE, un-ended links. A paused link is not a student being worked with. */
  active: number;
  /** The ceiling actually in force: the higher of the stored floor and the plan. */
  limit: number;
  /** The plan granting the ceiling, or null when the floor is doing the work. */
  plan: Plan | null;
  /** At or past the ceiling — the state the routes refuse in. */
  atLimit: boolean;
  /** The smallest band that would cover them, or null when past the largest. */
  suggested: Plan | null;
};

/**
 * Count the links that a plan is actually sold against.
 *
 * TEST_PREP_ONLY links are excluded: they belong to the other product and are
 * counted by lib/testprep/entitlement.ts against a tutor band. Counting them
 * here would bill one link twice for an account that runs both.
 */
export async function activeCaseloadCount(
  counselorAccountId: string,
): Promise<number> {
  return prisma.caseloadLink.count({
    where: {
      counselorAccountId,
      status: "ACTIVE",
      endedAt: null,
      scope: { not: "TEST_PREP_ONLY" },
    },
  });
}

/** Where this counselor stands against the ceiling in force. */
export async function counselorStanding(
  counselorAccountId: string,
): Promise<CounselorStanding> {
  const [account, active] = await Promise.all([
    prisma.counselorAccount.findUniqueOrThrow({
      where: { id: counselorAccountId },
      select: { caseloadLimit: true, userId: true },
    }),
    activeCaseloadCount(counselorAccountId),
  ]);

  const plan = await effectivePlanFor(account.userId, "COUNSELOR");
  const limit = Math.max(account.caseloadLimit, plan?.caseloadLimit ?? 0);

  return {
    active,
    limit,
    plan,
    atLimit: active >= limit,
    // What would fit them, which is only meaningful as a suggestion of the next
    // band UP — one that covers the student they are trying to add, not the
    // ones they already have.
    suggested: counselorBandFor(active + 1),
  };
}
