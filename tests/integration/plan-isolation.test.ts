// The isolation guarantee: plans are hypotheticals and must stay out of the
// student's real record.
//
// This is the whole reason PlannedItem is a separate table from ResumeItem and
// Projection is separate from Evaluation. If a plan could reach an evaluation
// snapshot or the progress chart, intentions would inflate the one number the
// student tracks — reintroducing exactly the untrustworthy-score problem that
// prompt v4 was written to fix.
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

// The server action calls revalidatePath, which needs Next's request context.
// What's under test here is the action's effect on the database.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const sessionUser = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("@/lib/session", () => ({
  getCurrentDbUser: async () => (sessionUser.id ? { id: sessionUser.id } : null),
  getCurrentUser: async () => (sessionUser.id ? { id: sessionUser.id } : null),
  requireUserId: async () => {
    if (!sessionUser.id) throw new Error("Not authenticated");
    return sessionUser.id;
  },
}));

import { getProfileWithRelations, getOwnedEvaluations } from "@/lib/ownership";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import { markPlanDoneAction } from "@/app/actions/plan";

const runTag = makeRunTag("iso");

describe.skipIf(!hasTestDb)("plans stay out of the real record", () => {
  afterAll(async () => {
    sessionUser.id = null;
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("a plan never appears in the profile an evaluation reads", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "sep");
    sessionUser.id = user.id;

    await prisma.resumeItem.create({
      data: { profileId: profile.id, type: "project", title: "Real thing" },
    });
    await prisma.plannedItem.create({
      data: { profileId: profile.id, type: "project", title: "Planned thing" },
    });

    const loaded = await getProfileWithRelations();
    const titles = loaded.resumeItems.map((i) => i.title);
    expect(titles).toContain("Real thing");
    expect(titles).not.toContain("Planned thing");

    // And the snapshot the model actually sees carries only the real item.
    const snapshot = buildSnapshot(loaded, null);
    expect(snapshot.resumeItems.map((i) => i.title)).toEqual(["Real thing"]);
  });

  it("a projection never appears in the evaluation history", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "hist");
    sessionUser.id = user.id;

    const evaluation = await prisma.evaluation.create({
      data: {
        profileId: profile.id,
        status: "completed",
        overallScore: 45,
        inputSnapshotJson: "{}",
      },
    });
    await prisma.projection.create({
      data: {
        profileId: profile.id,
        status: "completed",
        inputSnapshotJson: "{}",
        resultJson: "{}",
      },
    });

    const history = await getOwnedEvaluations();
    expect(history.map((e) => e.id)).toEqual([evaluation.id]);
  });

  it("marking a plan done converts it into a real item and removes the plan", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "done");
    sessionUser.id = user.id;

    const plan = await prisma.plannedItem.create({
      data: {
        profileId: profile.id,
        type: "leadership",
        title: "Programming club",
        org: "school",
        description: "Ran it weekly for a year.",
        hoursPerWeek: 2,
      },
    });

    const fd = new FormData();
    fd.set("id", plan.id);
    await markPlanDoneAction(fd);

    // Gone from plans...
    expect(
      await prisma.plannedItem.findUnique({ where: { id: plan.id } }),
    ).toBeNull();
    // ...and present as a real achievement, with its details carried over.
    const items = await prisma.resumeItem.findMany({
      where: { profileId: profile.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Programming club",
      org: "school",
      type: "leadership",
      hoursPerWeek: 2,
    });
  });

  it("cannot mark another user's plan done", async () => {
    const [a, b] = await Promise.all([
      createUserWithProfile(runTag, "mine2"),
      createUserWithProfile(runTag, "theirs2"),
    ]);
    const theirPlan = await prisma.plannedItem.create({
      data: { profileId: b.profile.id, type: "project", title: "Their plan" },
    });

    sessionUser.id = a.user.id;
    const fd = new FormData();
    fd.set("id", theirPlan.id);
    await expect(markPlanDoneAction(fd)).rejects.toThrow(
      "Planned item not found",
    );

    // Their plan is untouched and nothing was copied into my profile.
    expect(
      await prisma.plannedItem.findUnique({ where: { id: theirPlan.id } }),
    ).not.toBeNull();
    expect(
      await prisma.resumeItem.count({ where: { profileId: a.profile.id } }),
    ).toBe(0);
  });

  it("deleting the account removes plans and projections too", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "cascade");
    await prisma.plannedItem.create({
      data: { profileId: profile.id, type: "project", title: "P" },
    });
    await prisma.projection.create({
      data: { profileId: profile.id, status: "completed" },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(
      await prisma.plannedItem.count({ where: { profileId: profile.id } }),
    ).toBe(0);
    expect(
      await prisma.projection.count({ where: { profileId: profile.id } }),
    ).toBe(0);
  });
});
