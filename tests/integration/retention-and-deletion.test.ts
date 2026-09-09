// Retention and deletion, against a real database.
//
// Both are destructive, and both are the kind of thing whose bugs are only
// visible in the shape of the rows afterwards — a WHERE clause that matches one
// row too many, a cascade that leaves an orphan. A mocked Prisma would confirm
// whatever the code believes about itself.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { sweepExpiredProse } from "@/lib/evaluation/retention-sweep";
import { backfillChartPoints } from "@/lib/evaluation/backfill-chart-points";
import { parseChartPoint } from "@/lib/evaluation/chart-point";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";
import { legacyResult } from "../unit/fixtures/legacy-result";

const runTag = makeRunTag("retention");
const d = hasTestDb ? describe : describe.skip;

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

async function makeEvaluation(
  profileId: string,
  createdAt: Date,
  over: Record<string, unknown> = {},
) {
  return prisma.evaluation.create({
    data: {
      profileId,
      status: "completed",
      isSample: false,
      overallScore: 58,
      resultJson: JSON.stringify(legacyResult),
      inputSnapshotJson: JSON.stringify({ items: ["an essay draft"] }),
      promptVersion: "evaluation/v10",
      createdAt,
      ...over,
    },
  });
}

/**
 * Put this account on a live paid subscription.
 *
 * A real Subscription row rather than a stubbed entitlement check, because the
 * thing under test is precisely whether the sweep's notion of "is paying"
 * matches the app's — and a mock of that agrees with whatever the sweep
 * believes.
 */
async function makePaying(userId: string, over: Record<string, unknown> = {}) {
  return prisma.subscription.create({
    data: {
      userId,
      planCode: "STUDENT_PLUS",
      status: "active",
      stripeSubscriptionId: `sub_${userId}`,
      stripeCustomerId: `cus_${userId}`,
      currentPeriodEnd: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
      ...over,
    },
  });
}

d("the retention sweep", () => {
  let profileId = "";
  let userId = "";

  beforeEach(async () => {
    await cleanupRun(runTag);
    const made = await createUserWithProfile(runTag, "ret");
    profileId = made.profile.id;
    userId = made.user.id;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("refuses to delete anything while chart points are missing", async () => {
    // The precondition that keeps four years of scores alive. An un-backfilled
    // row's numbers live only inside its narrative.
    await makeEvaluation(profileId, daysAgo(500), { chartPointJson: null });

    const result = await sweepExpiredProse(NOW);
    expect(result.ran).toBe(false);
    if (!result.ran) expect(result.reason).toBe("backfill-incomplete");

    // And nothing was touched.
    const row = await prisma.evaluation.findFirst({ where: { profileId } });
    expect(row?.resultJson).not.toBeNull();
  });

  it("clears the snapshot first and the narrative later", async () => {
    // Staged on a PAYING account, because only the paid window has daylight
    // between the two cutoffs (60 and 365). On the free plan both land at 30,
    // which is the point of the tier and is covered by its own test below.
    await makePaying(userId);

    const recent = await makeEvaluation(profileId, daysAgo(10));
    const middling = await makeEvaluation(profileId, daysAgo(120));
    const old = await makeEvaluation(profileId, daysAgo(500));

    await backfillChartPoints();
    const result = await sweepExpiredProse(NOW);
    expect(result.ran).toBe(true);

    const [r, m, o] = await Promise.all(
      [recent.id, middling.id, old.id].map((id) =>
        prisma.evaluation.findUniqueOrThrow({ where: { id } }),
      ),
    );

    // Recent: untouched.
    expect(r.inputSnapshotJson).not.toBeNull();
    expect(r.resultJson).not.toBeNull();

    // Middling: raw profile gone, write-up still readable.
    expect(m.inputSnapshotJson).toBeNull();
    expect(m.resultJson).not.toBeNull();

    // Old: both gone.
    expect(o.inputSnapshotJson).toBeNull();
    expect(o.resultJson).toBeNull();
  });

  it("never touches a score, at any age", async () => {
    // The promise the whole design rests on: the chart covers four years even
    // though the prose covers one.
    const old = await makeEvaluation(profileId, daysAgo(1400));
    await backfillChartPoints();
    await sweepExpiredProse(NOW);

    const row = await prisma.evaluation.findUniqueOrThrow({ where: { id: old.id } });
    expect(row.resultJson).toBeNull();
    expect(row.overallScore).toBe(58);

    const point = parseChartPoint(row.chartPointJson);
    expect(point?.overall).toBe(58);
    expect(point?.schools.length).toBeGreaterThan(0);
  });

  it("keeps a payer's write-up that a free account of the same age loses", async () => {
    // The tier split, tested as one fact rather than two: the SAME age, swept
    // in the SAME pass, kept for one account and deleted for the other.
    const free = await createUserWithProfile(runTag, "free");
    const paid = await createUserWithProfile(runTag, "paid");
    await makePaying(paid.user.id);

    const freeEval = await makeEvaluation(free.profile.id, daysAgo(60));
    const paidEval = await makeEvaluation(paid.profile.id, daysAgo(60));

    await backfillChartPoints();
    const result = await sweepExpiredProse(NOW);
    expect(result.ran).toBe(true);
    if (result.ran) expect(result.paidAccounts).toBe(1);

    const [f, p] = await Promise.all(
      [freeEval.id, paidEval.id].map((id) =>
        prisma.evaluation.findUniqueOrThrow({ where: { id } }),
      ),
    );
    expect(f!.resultJson).toBeNull();
    expect(p!.resultJson).not.toBeNull();
  });

  it("keeps the long window for a cancelled plan still inside its paid period", async () => {
    // The case a WHERE clause on status = 'active' would get wrong, and getting
    // it wrong deletes a paying customer's data early. Stripe marks a
    // subscription canceled the moment somebody cancels, but they keep the plan
    // until the period they already paid for runs out.
    const user = await createUserWithProfile(runTag, "cancelled");
    await makePaying(user.user.id, {
      status: "canceled",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000),
    });

    const kept = await makeEvaluation(user.profile.id, daysAgo(60));
    await backfillChartPoints();
    await sweepExpiredProse(NOW);

    const row = await prisma.evaluation.findUniqueOrThrow({ where: { id: kept.id } });
    expect(row.resultJson).not.toBeNull();
  });

  it("still keeps every score on the free plan", async () => {
    // The shorter window must never reach the chart. Free is where that is
    // most likely to break, because it is the tier that deletes soonest.
    const old = await makeEvaluation(profileId, daysAgo(400));
    await backfillChartPoints();
    await sweepExpiredProse(NOW);

    const row = await prisma.evaluation.findUniqueOrThrow({ where: { id: old.id } });
    expect(row.resultJson).toBeNull();
    expect(row.overallScore).toBe(58);
    expect(parseChartPoint(row.chartPointJson)?.overall).toBe(58);
  });

  it("is idempotent — a second pass clears nothing more", async () => {
    await makeEvaluation(profileId, daysAgo(500));
    await backfillChartPoints();
    await sweepExpiredProse(NOW);

    const second = await sweepExpiredProse(NOW);
    expect(second.ran).toBe(true);
    if (second.ran) {
      expect(second.snapshotsCleared).toBe(0);
      expect(second.resultsCleared).toBe(0);
    }
  });

  it("backfills a chart point from a narrative before it expires", async () => {
    const e = await makeEvaluation(profileId, daysAgo(500), { chartPointJson: null });
    const backfill = await backfillChartPoints();
    expect(backfill.written).toBeGreaterThan(0);

    const row = await prisma.evaluation.findUniqueOrThrow({ where: { id: e.id } });
    const point = parseChartPoint(row.chartPointJson);
    expect(point?.overall).toBe(58);
    // Read out of the narrative that is about to be deleted.
    expect(point?.schools[0]?.name).toBe(legacyResult.schoolFits[0]!.schoolName);
  });
});

d("deleting an account", () => {
  it("leaves nothing of the student behind", async () => {
    const tag = makeRunTag("delete");
    const { user, profile } = await createUserWithProfile(tag, "gone");
    await makeEvaluation(profile.id, daysAgo(5));
    await prisma.plannedItem.create({
      data: { profileId: profile.id, type: "ACTIVITY", title: "A plan" },
    });

    await prisma.user.delete({ where: { id: user.id } });

    // Everything hanging off the account is gone, by cascade rather than by a
    // list of deletes somebody has to remember to extend.
    const [profiles, evaluations, plans] = await Promise.all([
      prisma.profile.count({ where: { userId: user.id } }),
      prisma.evaluation.count({ where: { profileId: profile.id } }),
      prisma.plannedItem.count({ where: { profileId: profile.id } }),
    ]);
    expect({ profiles, evaluations, plans }).toEqual({
      profiles: 0,
      evaluations: 0,
      plans: 0,
    });
  });

  it("takes subscriptions with it, so no row outlives the account", async () => {
    const tag = makeRunTag("delete-sub");
    const { user } = await createUserWithProfile(tag, "sub");
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: `cus_${tag}` },
    });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planCode: "STUDENT_PLUS",
        stripeSubscriptionId: `sub_${tag}`,
        stripeCustomerId: `cus_${tag}`,
        status: "active",
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(0);
  });
});
