// The follow-through loop has to close, not just open.
//
// Every review proposes two to four commitments. Before this existed nothing
// ever cleared one, so the second review left up to eight open proposals — many
// of them near-duplicates of the first review's — and the third left twelve.
// They all landed in "do this next" and all went into every check-in's context.
// A student who ignored a proposal once saw it forever, beside its own twin.
//
// The fix has to hold two things apart, and the difference between them is who
// decided: an unanswered PROPOSAL is the app's suggestion and a later review
// may retire it, while anything the student ACCEPTED is theirs and no review
// gets to cancel it on their behalf.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("commit-loop");

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { recordProposedCommitments, loadOpenCommitments } = await import(
  "@/lib/commitments/store"
);
const { loadDashboard } = await import("@/lib/dashboard/load");

describe.skipIf(!hasTestDb)("a second review does not stack proposals", () => {
  let profileId = "";

  beforeEach(async () => {
    const { user, profile } = await createUserWithProfile(
      runTag,
      `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    sessionUserId.current = user.id;
    profileId = profile.id;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  /**
   * A completed review with a readable narrative.
   *
   * resultJson is not optional dressing here: the dashboard only reports a
   * `latest` when the newest row parses into a known shape, so a row without
   * one produces an empty "do this next" and a test that passes for the wrong
   * reason.
   */
  async function review() {
    return prisma.evaluation.create({
      data: {
        profileId,
        status: "completed",
        completedAt: new Date(),
        promptVersion: "evaluation/v11",
        overallScore: 58,
        resultJson: JSON.stringify({
          overallScore: 58,
          gradeRelativeScore: 81,
          gradeContext: "Two different questions.",
          changeSinceLast: "First run.",
          headline: "A headline.",
          summary: "A summary.",
          strengths: [],
          weaknesses: [],
          narrativeCoherence: { score: 70, assessment: "ok" },
          schoolFits: [],
          itemAssessments: [],
          actions: [],
          gaps: [],
          verifyThese: [],
        }),
      },
    });
  }

  const proposals = [
    { description: "Enter the olympiad", targetRung: null, dueInWeeks: 8 },
    { description: "Send the write-up to a teacher", targetRung: null, dueInWeeks: 4 },
  ];

  it("retires the first review's unanswered proposals", async () => {
    const first = await review();
    await recordProposedCommitments({
      profileId,
      evaluationId: first.id,
      proposals,
    });
    expect(await loadOpenCommitments(profileId)).toHaveLength(2);

    const second = await review();
    const result = await recordProposedCommitments({
      profileId,
      evaluationId: second.id,
      proposals: [
        { description: "Ship the simulation", targetRung: null, dueInWeeks: 6 },
        { description: "Ask for the reference", targetRung: null, dueInWeeks: 10 },
      ],
    });

    expect(result.superseded).toBe(2);
    expect(result.created).toBe(2);
    // Two open, not four. This is the whole point.
    const open = await loadOpenCommitments(profileId);
    expect(open).toHaveLength(2);
    expect(open.map((c) => c.description).sort()).toEqual([
      "Ask for the reference",
      "Ship the simulation",
    ]);
  });

  it("records WHICH review retired them, and when", async () => {
    // Superseding without a trace would look identical to a deletion, and the
    // follow-through history is the only thing this table is for.
    const first = await review();
    await recordProposedCommitments({ profileId, evaluationId: first.id, proposals });
    const second = await review();
    await recordProposedCommitments({
      profileId,
      evaluationId: second.id,
      proposals: [
        { description: "Ship it", targetRung: null, dueInWeeks: 6 },
        { description: "Ask for it", targetRung: null, dueInWeeks: 8 },
      ],
    });

    const retired = await prisma.commitment.findMany({
      where: { profileId, status: "SUPERSEDED" },
    });
    expect(retired).toHaveLength(2);
    for (const c of retired) {
      expect(c.resolvedInEvaluationId).toBe(second.id);
      expect(c.resolvedAt).not.toBeNull();
      // NOT abandoned. The student never looked at these, and filing them as a
      // decision they made would then be quoted back to them as evidence.
      expect(c.status).not.toBe("ABANDONED");
    }
  });

  it("never touches something the student accepted", async () => {
    // The line this must not cross. They said yes; a later review does not get
    // to cancel it, and the check-in exists to keep asking about exactly these.
    const first = await review();
    await recordProposedCommitments({ profileId, evaluationId: first.id, proposals });
    const accepted = (await loadOpenCommitments(profileId))[0]!;
    await prisma.commitment.update({
      where: { id: accepted.id },
      data: { status: "ACCEPTED" },
    });

    const second = await review();
    await recordProposedCommitments({
      profileId,
      evaluationId: second.id,
      proposals: [
        { description: "Ship it", targetRung: null, dueInWeeks: 6 },
        { description: "Ask for it", targetRung: null, dueInWeeks: 8 },
      ],
    });

    const still = await prisma.commitment.findUniqueOrThrow({
      where: { id: accepted.id },
    });
    expect(still.status).toBe("ACCEPTED");
  });

  it("does not re-propose something already accepted", async () => {
    const first = await review();
    await recordProposedCommitments({ profileId, evaluationId: first.id, proposals });
    const open = await loadOpenCommitments(profileId);
    const olympiad = open.find((c) => c.description === "Enter the olympiad")!;
    await prisma.commitment.update({
      where: { id: olympiad.id },
      data: { status: "ACCEPTED" },
    });

    // The second review proposes it again anyway — the prompt tells it not to,
    // and this is the backstop for when it does so regardless.
    const second = await review();
    await recordProposedCommitments({
      profileId,
      evaluationId: second.id,
      proposals: [
        { description: "Enter the olympiad.", targetRung: null, dueInWeeks: 8 },
        { description: "Ship the simulation", targetRung: null, dueInWeeks: 6 },
      ],
    });

    const after = await loadOpenCommitments(profileId);
    const olympiads = after.filter((c) =>
      c.description.toLowerCase().startsWith("enter the olympiad"),
    );
    expect(olympiads).toHaveLength(1);
    expect(olympiads[0]!.status).toBe("ACCEPTED");
  });

  it("does not supersede its own proposals if run twice for one review", async () => {
    // Defensive: a retry that reached this code twice would otherwise retire
    // everything it had just written and leave the student with nothing.
    const only = await review();
    await recordProposedCommitments({ profileId, evaluationId: only.id, proposals });
    const again = await recordProposedCommitments({
      profileId,
      evaluationId: only.id,
      proposals,
    });
    expect(again.superseded).toBe(0);
    // And the duplicates are not written a second time either.
    expect(await loadOpenCommitments(profileId)).toHaveLength(2);
  });

  it("keeps 'do this next' from filling with the same advice twice", async () => {
    // The user-visible symptom, on the surface it appeared on.
    const first = await review();
    await recordProposedCommitments({ profileId, evaluationId: first.id, proposals });
    const second = await review();
    await recordProposedCommitments({
      profileId,
      evaluationId: second.id,
      proposals: [
        { description: "Enter the olympiad", targetRung: null, dueInWeeks: 8 },
        { description: "Ship the simulation", targetRung: null, dueInWeeks: 6 },
      ],
    });

    const data = await loadDashboard();
    const titles = data.latest?.nextSteps.map((s) => s.title) ?? [];
    const olympiads = titles.filter((t) => t === "Enter the olympiad");
    expect(olympiads).toHaveLength(1);
    expect(titles).not.toContain("Send the write-up to a teacher");
  });

  it("orders what it hands back by due date, so a cut keeps the deadlines", async () => {
    const only = await review();
    await recordProposedCommitments({
      profileId,
      evaluationId: only.id,
      proposals: [
        { description: "Later", targetRung: null, dueInWeeks: 40 },
        { description: "Sooner", targetRung: null, dueInWeeks: 2 },
      ],
    });
    const open = await loadOpenCommitments(profileId, 1);
    expect(open).toHaveLength(1);
    expect(open[0]!.description).toBe("Sooner");
  });

  it("never reads another account's commitments", async () => {
    const other = await createUserWithProfile(runTag, `x${Date.now()}`);
    const theirs = await prisma.evaluation.create({
      data: { profileId: other.profile.id, status: "completed" },
    });
    await recordProposedCommitments({
      profileId: other.profile.id,
      evaluationId: theirs.id,
      proposals,
    });

    expect(await loadOpenCommitments(profileId)).toHaveLength(0);

    // And this profile's own review must not retire theirs.
    const mine = await review();
    const result = await recordProposedCommitments({
      profileId,
      evaluationId: mine.id,
      proposals,
    });
    expect(result.superseded).toBe(0);
    expect(await loadOpenCommitments(other.profile.id)).toHaveLength(2);
  });
});
