// Who the reminder job would actually consider, read from a real database.
//
// The RULES are pure and tested in tests/unit/reminders.test.ts. What cannot
// be tested there is the query that feeds them — and that query is where a
// mistake mails the wrong people, which is the one failure in this feature
// that cannot be taken back.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";
import { reminderCandidates } from "@/lib/email/reminders-store";
import { reminderDecision } from "@/lib/email/reminders";

const runTag = makeRunTag("cands");

const newUser = (label: string) =>
  createUserWithProfile(runTag, `${label}${Date.now()}${Math.random().toString(36).slice(2, 6)}`);

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/** A completed run, which is what makes a profile have a baseline. */
async function completedRun(profileId: string, at: Date) {
  await prisma.evaluation.create({
    data: {
      profileId,
      type: "DEEP_REVIEW",
      status: "completed",
      completedAt: at,
      createdAt: at,
      promptVersion: "evaluation/v11",
      isSample: false,
    },
  });
}

/** Enough for canRunEvaluation to say yes: a target and something to assess. */
async function makeEvaluable(profileId: string, tag: string) {
  await prisma.targetSchool.create({
    data: { profileId, name: `Example ${tag}`, country: "US" },
  });
  await prisma.resumeItem.create({
    data: { profileId, title: `Debate ${tag}`, type: "extracurricular" },
  });
}

const find = (list: Awaited<ReturnType<typeof reminderCandidates>>, id: string) =>
  list.find((c) => c.userId === id);

describe.skipIf(!hasTestDb)("who the reminder job considers", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("reports a lapsed student as due", async () => {
    const { user, profile } = await newUser("lapsed");
    await makeEvaluable(profile.id, "a");
    await completedRun(profile.id, daysAgo(40));

    const me = find(await reminderCandidates(), user.id);
    expect(me?.hasBaseline).toBe(true);
    expect(me?.canRun).toBe(true);
    expect(reminderDecision(me!).send).toBe(true);
  });

  it("does not consider a student who has never run anything", async () => {
    const { user, profile } = await newUser("never");
    await makeEvaluable(profile.id, "b");

    const me = find(await reminderCandidates(), user.id);
    expect(me?.hasBaseline).toBe(false);
    expect(reminderDecision(me!)).toEqual({ send: false, reason: "no-baseline" });
  });

  it("does not consider a profile that cannot be evaluated", async () => {
    // A run in their history but nothing to assess now: the button they would
    // be sent to is disabled.
    const { user, profile } = await newUser("empty");
    await completedRun(profile.id, daysAgo(40));

    const me = find(await reminderCandidates(), user.id);
    expect(me?.canRun).toBe(false);
    expect(reminderDecision(me!)).toEqual({ send: false, reason: "not-evaluable" });
  });

  it("reads the most recent run, not the oldest", async () => {
    // Otherwise somebody who ran last week is chased about a run from March.
    const { user, profile } = await newUser("recent");
    await makeEvaluable(profile.id, "c");
    await completedRun(profile.id, daysAgo(90));
    await completedRun(profile.id, daysAgo(2));

    const me = find(await reminderCandidates(), user.id);
    expect(reminderDecision(me!)).toEqual({ send: false, reason: "too-soon" });
  });

  it("ignores failed and sample runs when deciding there is a baseline", async () => {
    const { user, profile } = await newUser("failed");
    await makeEvaluable(profile.id, "d");
    await prisma.evaluation.create({
      data: {
        profileId: profile.id,
        type: "CHECK_IN",
        status: "failed",
        createdAt: daysAgo(30),
        isSample: false,
      },
    });
    await prisma.evaluation.create({
      data: {
        profileId: profile.id,
        type: "DEEP_REVIEW",
        status: "completed",
        createdAt: daysAgo(30),
        isSample: true,
      },
    });

    const me = find(await reminderCandidates(), user.id);
    // A failure is not a baseline, and neither is placeholder output produced
    // without an API key.
    expect(me?.hasBaseline).toBe(false);
  });

  it("is not fooled by a failure that happened after a real run", async () => {
    // The bug this replaces: the query took the newest non-sample run and then
    // discarded it for not being completed, so a later failure hid the
    // baseline underneath it — and a student who had run something and been
    // gone a month was filed as "never ran anything" and never reminded.
    const { user, profile } = await newUser("masked");
    await makeEvaluable(profile.id, "f");
    await completedRun(profile.id, daysAgo(40));
    await prisma.evaluation.create({
      data: {
        profileId: profile.id,
        type: "CHECK_IN",
        status: "failed",
        createdAt: daysAgo(1),
        isSample: false,
      },
    });

    const me = find(await reminderCandidates(), user.id);
    expect(me?.hasBaseline).toBe(true);
    // And the age is measured from the run that WORKED, not the failure.
    expect(reminderDecision(me!).send).toBe(true);
  });

  it("leaves counselor accounts out entirely", async () => {
    // A caseload account is not a student and does not run its own check-ins.
    const { user } = await newUser("counselor");
    await prisma.counselorAccount.create({
      data: { userId: user.id, orgName: "Test Org" },
    });

    expect(find(await reminderCandidates(), user.id)).toBeUndefined();
  });

  it("carries the opt-out through, so the rules can honour it", async () => {
    const { user, profile } = await newUser("optout");
    await makeEvaluable(profile.id, "e");
    await completedRun(profile.id, daysAgo(40));
    await prisma.user.update({
      where: { id: user.id },
      data: { remindersOptOutAt: new Date() },
    });

    const me = find(await reminderCandidates(), user.id);
    expect(reminderDecision(me!)).toEqual({ send: false, reason: "opted-out" });
  });
});
