// What a counselor's plan actually covers.
//
// The ceiling used to be CounselorAccount.caseloadLimit, set by hand, with two
// routes refusing work and telling the counselor to "raise the plan" when there
// was no plan to raise. These tests are about the merge that fixed it, and they
// run against a real database because the failure mode is a query returning the
// wrong number rather than a rule computing one.
//
// The rule mirrors lib/testprep/entitlement.ts: a purchased band DERIVES the
// ceiling, the stored limit is the FLOOR, and the higher wins. Both halves
// matter. Take the plan alone and every hand-built account drops to zero the day
// this ships; take the column alone and a counselor who has paid gets nothing
// for it, which is the bug being fixed.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { counselorStanding } from "@/lib/counselor/entitlement";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("cbill");
const d = hasTestDb ? describe : describe.skip;

const NOW = new Date();
const laterThanNow = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);

async function makeCounselor(label: string, caseloadLimit: number) {
  const { user } = await createUserWithProfile(runTag, label);
  const account = await prisma.counselorAccount.create({
    data: { userId: user.id, orgName: `Org ${label}`, caseloadLimit },
  });
  return { user, account };
}

/** An ACTIVE, fully-consented link — the only kind a plan is sold against. */
async function addStudent(
  counselorAccountId: string,
  label: string,
  over: Record<string, unknown> = {},
) {
  const student = await createUserWithProfile(runTag, label);
  return prisma.caseloadLink.create({
    data: {
      counselorAccountId,
      studentUserId: student.user.id,
      studentProfileId: student.profile.id,
      invitedBy: "COUNSELOR",
      status: "ACTIVE",
      studentConsentAt: NOW,
      guardianConsentAt: NOW,
      startedAt: NOW,
      ...over,
    },
  });
}

async function subscribe(userId: string, planCode: string, status = "active") {
  return prisma.subscription.create({
    data: {
      userId,
      planCode,
      status,
      stripeSubscriptionId: `sub_${planCode}_${userId}`,
      stripeCustomerId: `cus_${userId}`,
      currentPeriodEnd: laterThanNow,
    },
  });
}

d("what a counselor's plan covers", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("uses the stored limit when there is no subscription", async () => {
    // Every counselor account that existed before billing works exactly this
    // way, and must keep working.
    const { account } = await makeCounselor("floor", 7);
    const standing = await counselorStanding(account.id);

    expect(standing.limit).toBe(7);
    expect(standing.plan).toBeNull();
  });

  it("raises the ceiling to the purchased band", async () => {
    const { user, account } = await makeCounselor("bought", 7);
    await subscribe(user.id, "COUNSELOR_20");

    const standing = await counselorStanding(account.id);
    expect(standing.limit).toBe(20);
    expect(standing.plan?.code).toBe("COUNSELOR_20");
  });

  it("keeps the stored limit when it is higher than the band", async () => {
    // A hand-set ceiling is a promise somebody made to this counselor. Buying a
    // small band must not quietly take it away.
    const { user, account } = await makeCounselor("generous", 80);
    await subscribe(user.id, "COUNSELOR_20");

    const standing = await counselorStanding(account.id);
    expect(standing.limit).toBe(80);
  });

  it("reverts on its own when the band lapses, with nothing to sync", async () => {
    // The reason the band derives the ceiling instead of being copied onto the
    // account: there is no write to undo, so a lapse cannot leave a paid-for
    // ceiling behind.
    const { user, account } = await makeCounselor("lapsed", 7);
    await subscribe(user.id, "COUNSELOR_50", "canceled");
    await prisma.subscription.updateMany({
      where: { userId: user.id },
      data: { currentPeriodEnd: new Date(NOW.getTime() - 1000) },
    });

    const standing = await counselorStanding(account.id);
    expect(standing.limit).toBe(7);
    expect(standing.plan).toBeNull();
  });

  it("ignores a tutor band bought on the same account", async () => {
    // The two products share an account row and nothing else. A tutor band must
    // not raise the ceiling the counselor routes read.
    const { user, account } = await makeCounselor("crossed", 7);
    await subscribe(user.id, "TUTOR_50");

    const standing = await counselorStanding(account.id);
    expect(standing.limit).toBe(7);
    expect(standing.plan).toBeNull();
  });
});

d("what counts against the plan", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("counts active, fully-consented students", async () => {
    const { account } = await makeCounselor("counting", 20);
    await addStudent(account.id, "s1");
    await addStudent(account.id, "s2");

    expect((await counselorStanding(account.id)).active).toBe(2);
  });

  it("does not count a link that is pending, paused or ended", async () => {
    // None of these is a student being worked with, and charging for one would
    // be charging for a row.
    const { account } = await makeCounselor("inactive", 20);
    await addStudent(account.id, "p1", { status: "PENDING" });
    await addStudent(account.id, "p2", { status: "ENDED", endedAt: NOW });

    expect((await counselorStanding(account.id)).active).toBe(0);
  });

  it("does not count a test-prep link, which the other band bills for", async () => {
    // An account running both products would otherwise pay twice for one link.
    const { account } = await makeCounselor("both", 20);
    await addStudent(account.id, "counseled");
    await addStudent(account.id, "tutored", { scope: "TEST_PREP_ONLY" });

    expect((await counselorStanding(account.id)).active).toBe(1);
  });

  it("reports being at the limit, and what would fit", async () => {
    const { account } = await makeCounselor("full", 2);
    await addStudent(account.id, "f1");
    await addStudent(account.id, "f2");

    const standing = await counselorStanding(account.id);
    expect(standing.atLimit).toBe(true);
    // The band that covers the student they are trying to ADD, not the ones
    // already held.
    expect(standing.suggested?.code).toBe("COUNSELOR_20");
  });

  it("is not at the limit with room left", async () => {
    const { account } = await makeCounselor("roomy", 5);
    await addStudent(account.id, "r1");

    const standing = await counselorStanding(account.id);
    expect(standing.atLimit).toBe(false);
  });
});
