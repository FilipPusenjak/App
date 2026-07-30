// The stale-pending sweep, against a real database.
//
// Two things matter here: it must recover abandoned runs (so an interrupted
// evaluation stops showing as "pending" forever), and — like every other query
// in this app — it must be incapable of touching another user's rows.
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";
import { prisma } from "@/lib/db";

const sessionUser = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("@/lib/session", () => ({
  getCurrentDbUser: async () => (sessionUser.id ? { id: sessionUser.id } : null),
  getCurrentUser: async () => (sessionUser.id ? { id: sessionUser.id } : null),
  requireUserId: async () => {
    if (!sessionUser.id) throw new Error("Not authenticated");
    return sessionUser.id;
  },
}));

import {
  STALE_PENDING_MESSAGE,
  STALE_PENDING_MINUTES,
} from "@/lib/evaluation/stale";
import { failStalePendingEvaluations } from "@/lib/evaluation/stale-sweep";

const runTag = makeRunTag("stale");
const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

function createPending(profileId: string, createdAt: Date) {
  return prisma.evaluation.create({
    data: {
      profileId,
      status: "pending",
      inputSnapshotJson: "{}",
      createdAt,
    },
  });
}

describe.skipIf(!hasTestDb)("failStalePendingEvaluations", () => {
  afterAll(async () => {
    sessionUser.id = null;
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("marks an abandoned run failed, with an explanation the student can act on", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "abandoned");
    sessionUser.id = user.id;
    const dead = await createPending(
      profile.id,
      minutesAgo(STALE_PENDING_MINUTES + 5),
    );

    const swept = await failStalePendingEvaluations();
    expect(swept).toBe(1);

    const after = await prisma.evaluation.findUniqueOrThrow({
      where: { id: dead.id },
    });
    expect(after.status).toBe("failed");
    expect(after.error).toBe(STALE_PENDING_MESSAGE);
    expect(after.completedAt).not.toBeNull();
  });

  it("leaves a run that is still in progress alone", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "inflight");
    sessionUser.id = user.id;
    const live = await createPending(profile.id, minutesAgo(1));

    expect(await failStalePendingEvaluations()).toBe(0);
    const after = await prisma.evaluation.findUniqueOrThrow({
      where: { id: live.id },
    });
    expect(after.status).toBe("pending");
  });

  it("never rewrites an evaluation that already completed", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "done");
    sessionUser.id = user.id;
    const completed = await prisma.evaluation.create({
      data: {
        profileId: profile.id,
        status: "completed",
        overallScore: 61,
        inputSnapshotJson: "{}",
        createdAt: minutesAgo(STALE_PENDING_MINUTES + 120),
      },
    });

    expect(await failStalePendingEvaluations()).toBe(0);
    const after = await prisma.evaluation.findUniqueOrThrow({
      where: { id: completed.id },
    });
    expect(after.status).toBe("completed");
    expect(after.overallScore).toBe(61);
  });

  it("cannot touch another user's stale rows", async () => {
    const [a, b] = await Promise.all([
      createUserWithProfile(runTag, "sweeper"),
      createUserWithProfile(runTag, "bystander"),
    ]);
    const stale = minutesAgo(STALE_PENDING_MINUTES + 5);
    const [mine, theirs] = await Promise.all([
      createPending(a.profile.id, stale),
      createPending(b.profile.id, stale),
    ]);

    sessionUser.id = a.user.id;
    expect(await failStalePendingEvaluations()).toBe(1);

    expect(
      (await prisma.evaluation.findUniqueOrThrow({ where: { id: mine.id } }))
        .status,
    ).toBe("failed");
    // B's row is equally stale and was left untouched.
    expect(
      (await prisma.evaluation.findUniqueOrThrow({ where: { id: theirs.id } }))
        .status,
    ).toBe("pending");
  });

  it("refuses to run at all when signed out", async () => {
    sessionUser.id = null;
    await expect(failStalePendingEvaluations()).rejects.toThrow(
      "Not authenticated",
    );
  });
});
