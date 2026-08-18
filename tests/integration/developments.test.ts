// What the student says happened.
//
// This table is the least structured and most personal thing the app stores:
// free text a 14-year-old wrote about their own life. So the isolation tests
// here are not a formality — they are the same rule as everywhere else in the
// app, applied to the data where a leak would matter most.
//
// The behavioural half is about being LISTENED TO. A student who writes "I got
// the role" and is then told nothing changed has been ignored, and a student
// asked the same question two fortnights running learns the box does nothing.
// Both are silent failures of a feature whose entire purpose is that someone
// reads it.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("dev");

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  addDevelopment,
  deleteDevelopment,
  getOwnedDevelopments,
  getUnreadDevelopments,
  markDevelopmentsRead,
  DEVELOPMENT_MAX,
  developmentInputSchema,
} = await import("@/lib/developments");
const { detectMaterialChange } = await import("@/lib/evaluation/material-change");
const { getRecentDevelopments } = await import("@/lib/developments");
const { buildDeepReviewContext } = await import(
  "@/lib/evaluation/context/deep-review"
);

describe.skipIf(!hasTestDb)("developments", () => {
  let profileId = "";
  let userId = "";

  beforeEach(async () => {
    const { user, profile } = await createUserWithProfile(
      runTag,
      `u${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    sessionUserId.current = user.id;
    userId = user.id;
    profileId = profile.id;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("records what the student wrote, against their own profile only", async () => {
    const created = await addDevelopment({ body: "Asked the coach — I'm prepping a witness." });
    expect(created.body).toContain("prepping a witness");

    const row = await prisma.development.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.profileId).toBe(profileId);
    // Unread until a check-in uses it.
    expect(row.readByEvaluationId).toBeNull();
  });

  it("never reads another account's notes", async () => {
    const other = await createUserWithProfile(runTag, `other${Date.now()}`);
    await prisma.development.create({
      data: { profileId: other.profile.id, body: "Not yours." },
    });

    const mine = await getOwnedDevelopments();
    expect(mine).toHaveLength(0);
  });

  it("never deletes another account's note", async () => {
    const other = await createUserWithProfile(runTag, `otherdel${Date.now()}`);
    const theirs = await prisma.development.create({
      data: { profileId: other.profile.id, body: "Still not yours." },
    });

    expect(await deleteDevelopment(theirs.id)).toBe(false);
    // And it is still there.
    expect(
      await prisma.development.findUnique({ where: { id: theirs.id } }),
    ).not.toBeNull();
  });

  it("lets a student take their own words back", async () => {
    // Not a nicety: this is free text written in the moment by a minor, and
    // being able to remove it is part of it being safe to write.
    const created = await addDevelopment({ body: "Wrote this in a bad mood." });
    expect(await deleteDevelopment(created.id)).toBe(true);
    expect(
      await prisma.development.findUnique({ where: { id: created.id } }),
    ).toBeNull();
  });

  it("refuses a commitment id belonging to someone else", async () => {
    // The only client-supplied id this table accepts, and the only cross-account
    // write it could otherwise permit.
    const other = await createUserWithProfile(runTag, `oc${Date.now()}`);
    const theirCommitment = await prisma.commitment.create({
      data: { profileId: other.profile.id, description: "Theirs", status: "PROPOSED" },
    });

    const created = await addDevelopment({
      body: "Trying to attach this to someone else's commitment.",
      commitmentId: theirCommitment.id,
    });
    // Stored, but unlinked — the note is the student's own, the link is not.
    expect(created.commitmentId).toBeNull();
  });

  it("links to a commitment the student does own", async () => {
    const mine = await prisma.commitment.create({
      data: { profileId, description: "Ask the coach", status: "ACCEPTED" },
    });
    const created = await addDevelopment({
      body: "Asked, and they said yes.",
      commitmentId: mine.id,
    });
    expect(created.commitmentId).toBe(mine.id);
  });

  it("stops offering a note to check-ins once one has read it", async () => {
    // Being asked the same question two fortnights running is how a student
    // learns the box does nothing.
    const a = await addDevelopment({ body: "First thing that happened." });
    await addDevelopment({ body: "Second thing that happened." });

    expect(await getUnreadDevelopments(profileId)).toHaveLength(2);

    const evaluation = await prisma.evaluation.create({
      data: { profileId, type: "CHECK_IN", status: "completed" },
    });
    await markDevelopmentsRead([a.id], evaluation.id);

    const unread = await getUnreadDevelopments(profileId);
    expect(unread).toHaveLength(1);
    expect(unread[0]!.body).toContain("Second thing");
  });

  it("still shows a read note back to the student, marked as read", async () => {
    const created = await addDevelopment({ body: "Something worth keeping." });
    const evaluation = await prisma.evaluation.create({
      data: { profileId, type: "CHECK_IN", status: "completed" },
    });
    await markDevelopmentsRead([created.id], evaluation.id);

    const shown = await getOwnedDevelopments();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.readByEvaluationId).toBe(evaluation.id);
  });

  it("survives the commitment it answered being deleted", async () => {
    // What the student said happened is still true even when the commitment it
    // referred to is gone.
    const commitment = await prisma.commitment.create({
      data: { profileId, description: "Temporary", status: "PROPOSED" },
    });
    const created = await addDevelopment({
      body: "Did the thing.",
      commitmentId: commitment.id,
    });
    await prisma.commitment.delete({ where: { id: commitment.id } });

    const still = await prisma.development.findUnique({ where: { id: created.id } });
    expect(still).not.toBeNull();
    expect(still!.commitmentId).toBeNull();
  });

  it("goes with the profile when the account is deleted", async () => {
    await addDevelopment({ body: "Should not outlive the account." });
    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.development.count({ where: { profileId } })).toBe(0);
  });
});

describe("the input limits", () => {
  it("rejects an empty or near-empty note", () => {
    expect(developmentInputSchema.safeParse({ body: "" }).success).toBe(false);
    expect(developmentInputSchema.safeParse({ body: "ok" }).success).toBe(false);
  });

  it("caps length, so the box stays a fortnight's news and not a diary", () => {
    expect(
      developmentInputSchema.safeParse({ body: "a".repeat(DEVELOPMENT_MAX) }).success,
    ).toBe(true);
    expect(
      developmentInputSchema.safeParse({ body: "a".repeat(DEVELOPMENT_MAX + 1) }).success,
    ).toBe(false);
  });
});

describe("a reported development makes a check-in worth running", () => {
  const quiet = {
    scored: {
      thresholdBand: "gaps to close",
      differentiation: { band: "developing", activities: [] },
      pace: { status: "ON_PACE" },
    },
    previous: {
      thresholdBand: "gaps to close",
      differentiationBand: "developing",
      paceStatus: "ON_PACE",
      rungs: {},
    },
    changeCount: 0,
    openCommitments: [],
  } as unknown as Parameters<typeof detectMaterialChange>[0];

  it("is not material when nothing moved and nothing was said", () => {
    expect(detectMaterialChange(quiet).material).toBe(false);
  });

  it("IS material the moment the student reports something", () => {
    // The failure this prevents: a student writes "I got the role" and the app
    // answers "nothing changed since your last check-in".
    const verdict = detectMaterialChange({ ...quiet, unreadDevelopments: 1 });
    expect(verdict.material).toBe(true);
    expect(verdict.reasons.join(" ")).toMatch(/reported/i);
  });

  it("says so first, before anything the app computed", () => {
    const verdict = detectMaterialChange({
      ...quiet,
      unreadDevelopments: 2,
      changeCount: 3,
    });
    expect(verdict.reasons[0]).toMatch(/reported/i);
  });
});

describe.skipIf(!hasTestDb)("a deep review reads them too", () => {
  let profileId = "";

  beforeEach(async () => {
    const { user, profile } = await createUserWithProfile(
      runTag,
      `dr${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    sessionUserId.current = user.id;
    profileId = profile.id;
  });

  it("sees notes a check-in already read", async () => {
    // The distinction that matters. A check-in marking something read means
    // THAT check-in answered it; the strategy review has still never seen it,
    // and a fortnight's news is the raw material a months-long read is made of.
    const created = await addDevelopment({ body: "The club folded in October." });
    const checkIn = await prisma.evaluation.create({
      data: { profileId, type: "CHECK_IN", status: "completed" },
    });
    await markDevelopmentsRead([created.id], checkIn.id);

    expect(await getUnreadDevelopments(profileId)).toHaveLength(0);
    const forReview = await getRecentDevelopments(profileId, null);
    expect(forReview).toHaveLength(1);
    expect(forReview[0]!.body).toContain("club folded");
  });

  it("only takes what happened since the last deep review", async () => {
    await prisma.development.create({
      data: {
        profileId,
        body: "Old news, already covered by the last review.",
        createdAt: new Date("2026-01-01"),
      },
    });
    await prisma.development.create({
      data: {
        profileId,
        body: "New since then.",
        createdAt: new Date("2026-07-01"),
      },
    });

    const since = new Date("2026-06-01");
    const recent = await getRecentDevelopments(profileId, since);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.body).toContain("New since then");
  });

  it("puts them in the context, next to the commitment statuses they explain", async () => {
    const context = buildDeepReviewContext({
      scored: {
        rubricVersion: "readiness/v1",
        gradeLevel: 11,
        monthsUntilApplication: 14,
        thresholdBand: "gaps to close",
        threshold: { schools: [] },
        differentiation: {
          band: "developing",
          activities: [],
          stalled: [],
          topRungIndex: 2,
          sustainedThreadCount: 1,
        },
        pace: {
          status: "ON_PACE",
          unknownGrade: false,
          expectedTopRungIndex: 2,
          expectedSustainedThreads: 1,
        },
      } as unknown as Parameters<typeof buildDeepReviewContext>[0]["scored"],
      priorReviews: [],
      commitments: [
        {
          description: "Run the spring workshop",
          status: "ABANDONED",
          dueDate: null,
          resolvedAt: new Date("2026-05-01"),
        },
      ],
      developments: [
        { body: "The club folded, so the workshop could not happen.", createdAt: new Date("2026-05-02") },
      ],
      intendedMajor: "Physics",
      careerGoal: "Research",
      schoolContext: "A state comprehensive.",
      now: new Date("2026-06-01"),
    });

    expect(context.text).toContain("What the student reported, in their own words");
    expect(context.text).toContain("The club folded");
    // Directly after the commitment history, because that is what it explains:
    // abandoned-with-a-reason and abandoned-in-silence are opposite signals.
    const commitments = context.text.indexOf("## Commitments made in past reviews");
    const reported = context.text.indexOf("## What the student reported");
    const requirements = context.text.indexOf("## Requirements, per target");
    expect(commitments).toBeGreaterThan(-1);
    expect(reported).toBeGreaterThan(commitments);
    expect(reported).toBeLessThan(requirements);
  });

  it("omits the section entirely when there is nothing to report", () => {
    const context = buildDeepReviewContext({
      scored: {
        rubricVersion: "readiness/v1",
        gradeLevel: 11,
        monthsUntilApplication: 14,
        thresholdBand: "gaps to close",
        threshold: { schools: [] },
        differentiation: {
          band: "developing",
          activities: [],
          stalled: [],
          topRungIndex: 2,
          sustainedThreadCount: 1,
        },
        pace: {
          status: "ON_PACE",
          unknownGrade: false,
          expectedTopRungIndex: 2,
          expectedSustainedThreads: 1,
        },
      } as unknown as Parameters<typeof buildDeepReviewContext>[0]["scored"],
      priorReviews: [],
      commitments: [],
      developments: [],
      intendedMajor: null,
      careerGoal: null,
      schoolContext: null,
      now: new Date("2026-06-01"),
    });
    // An empty heading invites the model to fill it.
    expect(context.text).not.toContain("What the student reported");
  });
});
