// The commitments screen, and the advice log.
//
// Both are new surfaces over data that already existed, and both read records
// belonging to somebody else. So the tests that matter are the boundary ones:
// a commitment reachable only through a link that is ACTIVE and dually
// consented, and a recommendation that belongs to another caseload being not
// found rather than refused.
//
// THE BUCKETS ARE THE OTHER HALF. "Proposed and never answered" is a separate
// group from "agreed to and late" on purpose — the app proposes and the student
// accepts, so an unanswered suggestion is the app's own unread advice and not a
// promise a child broke. A test holds that apart, because collapsing the two is
// a one-line change that reads as a tidy-up.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("counselor-commit");
const d = hasTestDb ? describe : describe.skip;

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirected");
  },
}));

const { loadCaseloadCommitments } = await import("@/lib/counselor/commitments");
const { loadAdviceLog } = await import("@/lib/counselor/recommendations");

let seq = 0;
const uniq = () => `${runTag}-${seq++}`;

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY);

/** A counselor with one consenting student. */
async function scenario(opts: { consented?: boolean } = {}) {
  const counselor = await createUserWithProfile(runTag, `counselor-${uniq()}`);
  const account = await prisma.counselorAccount.create({
    data: {
      userId: counselor.user.id,
      orgName: `Advising ${uniq()}`,
      type: "INDEPENDENT",
    },
  });
  const student = await createUserWithProfile(runTag, `student-${uniq()}`);
  await prisma.profile.update({
    where: { id: student.profile.id },
    data: { studentName: `Student ${uniq()}`, gradeLevel: "Grade 11" },
  });

  const consented = opts.consented ?? true;
  const link = await prisma.caseloadLink.create({
    data: {
      counselorAccountId: account.id,
      studentUserId: student.user.id,
      studentProfileId: student.profile.id,
      status: consented ? "ACTIVE" : "PENDING",
      invitedBy: "STUDENT",
      scope: "FULL",
      studentConsentAt: ago(30),
      guardianConsentAt: consented ? ago(30) : null,
      startedAt: consented ? ago(30) : null,
    },
  });

  sessionUserId.current = counselor.user.id;
  return { counselor, account, student, link };
}

function commitment(
  profileId: string,
  over: Partial<{ description: string; status: string; dueDate: Date | null; resolvedAt: Date | null }> = {},
) {
  return prisma.commitment.create({
    data: {
      profileId,
      description: over.description ?? `Do the thing ${uniq()}`,
      status: over.status ?? "ACCEPTED",
      dueDate: over.dueDate === undefined ? ahead(3) : over.dueDate,
      resolvedAt: over.resolvedAt ?? null,
    },
  });
}

d("the commitments screen", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
  });
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("sorts what is agreed into overdue, this week, and later", async () => {
    const { student } = await scenario();
    await commitment(student.profile.id, { dueDate: ago(9), description: "late one" });
    await commitment(student.profile.id, { dueDate: ahead(2), description: "soon one" });
    await commitment(student.profile.id, { dueDate: ahead(40), description: "later one" });

    const c = await loadCaseloadCommitments();

    expect(c.overdue.map((r) => r.description)).toEqual(["late one"]);
    expect(c.soon.map((r) => r.description)).toEqual(["soon one"]);
    expect(c.later.map((r) => r.description)).toEqual(["later one"]);
    expect(c.liveCount).toBe(3);
  });

  it("keeps an unanswered proposal out of the overdue list", async () => {
    // The distinction this screen exists to preserve: the app suggested it and
    // nobody agreed, so a passed date is not a broken promise.
    const { student } = await scenario();
    await commitment(student.profile.id, {
      status: "PROPOSED",
      dueDate: ago(20),
      description: "never answered",
    });

    const c = await loadCaseloadCommitments();

    expect(c.overdue).toEqual([]);
    expect(c.unanswered.map((r) => r.description)).toEqual(["never answered"]);
  });

  it("puts the longest overdue first, because it has already been missed once", async () => {
    const { student } = await scenario();
    await commitment(student.profile.id, { dueDate: ago(2), description: "yesterday-ish" });
    await commitment(student.profile.id, { dueDate: ago(30), description: "a month ago" });

    const c = await loadCaseloadCommitments();

    expect(c.overdue.map((r) => r.description)).toEqual([
      "a month ago",
      "yesterday-ish",
    ]);
  });

  it("shows a commitment with no date without claiming it is late", async () => {
    const { student } = await scenario();
    await commitment(student.profile.id, { dueDate: null, description: "undated" });

    const c = await loadCaseloadCommitments();

    expect(c.overdue).toEqual([]);
    expect(c.later.map((r) => r.description)).toEqual(["undated"]);
    expect(c.later[0]!.daysUntilDue).toBeNull();
  });

  it("keeps a recently closed commitment and drops an old one", async () => {
    const { student } = await scenario();
    await commitment(student.profile.id, {
      status: "COMPLETED",
      resolvedAt: ago(5),
      description: "just finished",
    });
    await commitment(student.profile.id, {
      status: "ABANDONED",
      resolvedAt: ago(200),
      description: "ancient history",
    });

    const c = await loadCaseloadCommitments();

    expect(c.recentlyClosed.map((r) => r.description)).toEqual(["just finished"]);
    // Closed rows are not live, so they do not inflate the count a counselor
    // reads as their workload.
    expect(c.liveCount).toBe(0);
  });

  it("counts the students who have nothing outstanding", async () => {
    // The reassurance half, same as the attention list. A screen that only
    // ever shows work makes a caseload look worse than it is.
    const { account, student } = await scenario();
    const other = await createUserWithProfile(runTag, `student-${uniq()}`);
    await prisma.caseloadLink.create({
      data: {
        counselorAccountId: account.id,
        studentUserId: other.user.id,
        studentProfileId: other.profile.id,
        status: "ACTIVE",
        invitedBy: "STUDENT",
        scope: "FULL",
        studentConsentAt: ago(30),
        guardianConsentAt: ago(30),
        startedAt: ago(30),
      },
    });
    await commitment(student.profile.id);

    const c = await loadCaseloadCommitments();

    expect(c.totalActive).toBe(2);
    expect(c.studentsWithNothingLive).toBe(1);
  });

  it("shows nothing at all through a link the guardian has not agreed to", async () => {
    // The dual-consent gate, on a surface that did not exist when it was
    // written. A PENDING link returns nothing — not a redacted row, nothing.
    const { student } = await scenario({ consented: false });
    await commitment(student.profile.id, { dueDate: ago(9) });

    const c = await loadCaseloadCommitments();

    expect(c.liveCount).toBe(0);
    expect(c.totalActive).toBe(0);
    expect(c.overdue).toEqual([]);
  });

  it("does not reach another counselor's student", async () => {
    const mine = await scenario();
    const theirs = await scenario();
    await commitment(theirs.student.profile.id, { description: "not yours" });
    sessionUserId.current = mine.counselor.user.id;

    const c = await loadCaseloadCommitments();

    expect(
      [...c.overdue, ...c.soon, ...c.later, ...c.unanswered].map((r) => r.description),
    ).not.toContain("not yours");
  });

  it("stops reading a link that has been ended", async () => {
    const { student, link } = await scenario();
    await commitment(student.profile.id, { dueDate: ago(9) });
    await prisma.caseloadLink.update({
      where: { id: link.id },
      data: { status: "ENDED", endedAt: new Date() },
    });

    const c = await loadCaseloadCommitments();

    expect(c.totalActive).toBe(0);
    expect(c.liveCount).toBe(0);
  });
});

d("the advice log", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
  });
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  function recommendation(
    linkId: string,
    over: Partial<{ text: string; status: string; declineReason: string | null; source: string }> = {},
  ) {
    return prisma.counselorRecommendation.create({
      data: {
        caseloadLinkId: linkId,
        text: over.text ?? `Advice ${uniq()}`,
        basis: "signal.something — a computed fact",
        source: over.source ?? "MODEL_SUGGESTED",
        status: over.status ?? "PROPOSED",
        declineReason: over.declineReason ?? null,
      },
    });
  }

  it("groups by what happened to the advice", async () => {
    const { link } = await scenario();
    await recommendation(link.id, { text: "undecided", status: "PROPOSED" });
    await recommendation(link.id, { text: "passed on", status: "DELIVERED" });
    await recommendation(link.id, {
      text: "set aside",
      status: "DECLINED_BY_COUNSELOR",
      declineReason: "The family had already decided.",
    });
    await recommendation(link.id, { text: "taken up", status: "ACCEPTED_BY_STUDENT" });

    const log = await loadAdviceLog();

    expect(log.awaitingDecision.map((r) => r.text)).toEqual(["undecided"]);
    expect(log.delivered.map((r) => r.text)).toEqual(["passed on"]);
    expect(log.declined.map((r) => r.text)).toEqual(["set aside"]);
    expect(log.acceptedByStudent.map((r) => r.text)).toEqual(["taken up"]);
    expect(log.total).toBe(4);
  });

  it("keeps the decline reason, which is recorded nowhere else", async () => {
    const { link } = await scenario();
    await recommendation(link.id, {
      status: "DECLINED_BY_COUNSELOR",
      declineReason: "The job is not optional for this family.",
    });

    const log = await loadAdviceLog();

    expect(log.declined[0]!.declineReason).toBe(
      "The job is not optional for this family.",
    );
  });

  it("carries the basis, so an old call stays traceable", async () => {
    const { link } = await scenario();
    await recommendation(link.id);

    const log = await loadAdviceLog();

    expect(log.awaitingDecision[0]!.basis).toMatch(/computed fact/);
  });

  it("does not return another counselor's advice", async () => {
    const mine = await scenario();
    const theirs = await scenario();
    await recommendation(theirs.link.id, { text: "not yours" });
    sessionUserId.current = mine.counselor.user.id;

    const log = await loadAdviceLog();

    expect(log.total).toBe(0);
  });

  it("goes quiet when the link stops being readable", async () => {
    // The advice is the counselor's own, but it is ABOUT a student — so when
    // the grant ends it stops being readable with everything else.
    const { link } = await scenario();
    await recommendation(link.id, { status: "DELIVERED" });
    await prisma.caseloadLink.update({
      where: { id: link.id },
      data: { guardianConsentAt: null, status: "PENDING" },
    });

    const log = await loadAdviceLog();

    expect(log.total).toBe(0);
  });
});
