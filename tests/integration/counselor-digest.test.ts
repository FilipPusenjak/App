// The digest's database half: who it picks up, and who it must not.
//
// The rules live in lib/counselor/digest.ts and are tested directly. What can
// only be tested against a real database is the QUERY — and the query is where
// the disclosure risk is. Naming a student in an email is a disclosure, so a
// link the counselor cannot currently see must not produce one, and "cannot
// currently see" is a set of WHERE clauses that a mock would simply agree with.
//
// The consent cases below are the ones that matter. A link waiting on a
// guardian shows the counselor nothing in the app; if it put the student's name
// in their inbox, the app would have leaked precisely what dual consent exists
// to hold back.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { digestCandidates, markDigestSent } from "@/lib/counselor/digest-store";
import { unsubscribeByToken, unsubscribeTokenFor } from "@/lib/email/reminders-store";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("digest");
const d = hasTestDb ? describe : describe.skip;

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

async function makeCounselor(label: string) {
  const { user } = await createUserWithProfile(runTag, label);
  const account = await prisma.counselorAccount.create({
    data: { userId: user.id, orgName: `Org ${label}` },
  });
  return { user, account };
}

async function addStudent(
  counselorAccountId: string,
  label: string,
  over: Record<string, unknown> = {},
) {
  const student = await createUserWithProfile(runTag, label);
  await prisma.profile.update({
    where: { id: student.profile.id },
    data: { studentName: `Name ${label}` },
  });
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

async function addSignal(
  link: { id: string; counselorAccountId: string },
  over: Record<string, unknown> = {},
) {
  return prisma.triageSignal.create({
    data: {
      caseloadLinkId: link.id,
      counselorAccountId: link.counselorAccountId,
      kind: "STALE_PROFILE",
      severity: 3,
      computedAt: daysAgo(1),
      basis: {},
      ...over,
    },
  });
}

/** The one candidate this run created, by account id. */
async function candidateFor(accountId: string) {
  const all = await digestCandidates();
  return all.find((c) => c.counselorAccountId === accountId) ?? null;
}

d("who the digest picks up", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("reports a student with an unresolved signal", async () => {
    const { account } = await makeCounselor("basic");
    const link = await addStudent(account.id, "s1");
    await addSignal(link);

    const candidate = await candidateFor(account.id);
    expect(candidate?.students).toHaveLength(1);
    expect(candidate?.students[0]?.name).toBe("Name s1");
    expect(candidate?.email).toContain(runTag);
  });

  it("says nothing about a student whose signals are all resolved", async () => {
    const { account } = await makeCounselor("resolved");
    const link = await addStudent(account.id, "s2");
    await addSignal(link, { resolvedAt: NOW });

    expect((await candidateFor(account.id))?.students).toEqual([]);
  });

  it("says nothing about a student with no signals at all", async () => {
    const { account } = await makeCounselor("quiet");
    await addStudent(account.id, "s3");

    expect((await candidateFor(account.id))?.students).toEqual([]);
  });

  it("never names a student still waiting on a guardian", async () => {
    // THE disclosure case. This link shows the counselor nothing in the app;
    // putting the name in their inbox would leak exactly what dual consent is
    // there to hold back.
    const { account } = await makeCounselor("pending");
    const link = await addStudent(account.id, "s4", {
      status: "PENDING",
      guardianConsentAt: null,
    });
    await addSignal(link);

    expect((await candidateFor(account.id))?.students).toEqual([]);
  });

  it("never names a student whose guardian consent is missing on an active link", async () => {
    // Belt and braces: status alone is not the check. A row that is ACTIVE but
    // missing a consent timestamp must still be invisible.
    const { account } = await makeCounselor("noguardian");
    const link = await addStudent(account.id, "s5", { guardianConsentAt: null });
    await addSignal(link);

    expect((await candidateFor(account.id))?.students).toEqual([]);
  });

  it("never names a student whose link has ended", async () => {
    const { account } = await makeCounselor("ended");
    const link = await addStudent(account.id, "s6", {
      status: "ENDED",
      endedAt: NOW,
    });
    await addSignal(link);

    expect((await candidateFor(account.id))?.students).toEqual([]);
  });

  it("takes the highest severity and the most recent signal per student", async () => {
    // Both drive the ordering the counselor reads, and both are computed from
    // several rows rather than read from one.
    const { account } = await makeCounselor("worst");
    const link = await addStudent(account.id, "s7");
    await addSignal(link, { severity: 2, computedAt: daysAgo(9) });
    await addSignal(link, { severity: 5, computedAt: daysAgo(4) });
    await addSignal(link, { severity: 1, computedAt: daysAgo(2) });

    const student = (await candidateFor(account.id))?.students[0];
    expect(student?.topSeverity).toBe(5);
    expect(student?.signalCount).toBe(3);
    expect(student?.newestSignalAt.toISOString().slice(0, 10)).toBe(
      daysAgo(2).toISOString().slice(0, 10),
    );
  });

  it("keeps one counselor's caseload out of another's digest", async () => {
    const a = await makeCounselor("acct-a");
    const b = await makeCounselor("acct-b");
    const link = await addStudent(a.account.id, "s8");
    await addSignal(link);

    expect((await candidateFor(a.account.id))?.students).toHaveLength(1);
    expect((await candidateFor(b.account.id))?.students).toEqual([]);
  });

  it("carries the opt-out and the last-sent time the rules need", async () => {
    const { account } = await makeCounselor("state");
    await markDigestSent(account.id, daysAgo(3));

    const candidate = await candidateFor(account.id);
    expect(candidate?.lastDigestAt?.toISOString().slice(0, 10)).toBe(
      daysAgo(3).toISOString().slice(0, 10),
    );
    expect(candidate?.optedOutAt).toBeNull();
  });
});

d("one unsubscribe stops every stream", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("stops the digest as well as the check-in nudge", async () => {
    // A person clicking "unsubscribe" means stop mailing me. Honouring that
    // narrowly and then sending the other kind next week earns a spam
    // complaint the sender entirely deserves.
    const { user, account } = await makeCounselor("unsub");
    const token = await unsubscribeTokenFor(user.id);

    expect(await unsubscribeByToken(token)).toBe(true);

    const [row, counselor] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.counselorAccount.findUniqueOrThrow({ where: { id: account.id } }),
    ]);
    expect(row.remindersOptOutAt).not.toBeNull();
    expect(counselor.digestOptOutAt).not.toBeNull();

    // And the candidate the rules see reflects it, which is what actually
    // stops the mail.
    expect((await candidateFor(account.id))?.optedOutAt).not.toBeNull();
  });

  it("stays idempotent for an account with no caseload", async () => {
    // A prefetching mail client, a second click and a forwarded copy must all
    // produce the same already-unsubscribed state rather than an error.
    const { user } = await createUserWithProfile(runTag, "plain");
    const token = await unsubscribeTokenFor(user.id);

    expect(await unsubscribeByToken(token)).toBe(true);
    expect(await unsubscribeByToken(token)).toBe(true);
  });

  it("does not move an opt-out that was already recorded", async () => {
    const { user, account } = await makeCounselor("twice");
    const token = await unsubscribeTokenFor(user.id);

    await unsubscribeByToken(token);
    const first = await prisma.counselorAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: { digestOptOutAt: true },
    });

    await unsubscribeByToken(token);
    const second = await prisma.counselorAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: { digestOptOutAt: true },
    });
    expect(second.digestOptOutAt).toEqual(first.digestOptOutAt);
  });
});
