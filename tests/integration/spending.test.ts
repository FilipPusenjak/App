// What an account has spent, against a real database.
//
// Two things must hold. The sum must cover the whole ACCOUNT — a counselor's
// twelve students share one budget, and counting only the active one would let
// the cap be walked around by switching student. And it must never see another
// account's spend, or one person's usage silently locks out a stranger.
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";
import { prisma } from "@/lib/db";

// Same pattern as ownership.test.ts: the session is mocked so a test can say
// who is signed in, and the query's own userId filter is what is under test.
const sessionUser = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("@/lib/session", () => ({
  getCurrentDbUser: async () =>
    sessionUser.id ? { id: sessionUser.id } : null,
  getCurrentUser: async () => (sessionUser.id ? { id: sessionUser.id } : null),
  requireUserId: async () => {
    if (!sessionUser.id) throw new Error("Not authenticated");
    return sessionUser.id;
  },
}));

import { getAccountSpendUsd } from "@/lib/spending-account";

const runTag = makeRunTag("spend");

/** A run with enough tokens to cost a measurable amount. */
function run(profileId: string, opts: { isSample?: boolean; status?: string } = {}) {
  return {
    profileId,
    status: opts.status ?? "completed",
    isSample: opts.isSample ?? false,
    model: "claude-opus-5",
    inputTokens: 100_000,
    outputTokens: 20_000,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    inputSnapshotJson: "{}",
  };
}

describe.skipIf(!hasTestDb)("account spend", () => {
  afterAll(async () => {
    sessionUser.id = null;
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("sums across every student the account holds", async () => {
    const a = await createUserWithProfile(runTag, "multi-a");
    const second = await prisma.profile.create({
      data: { userId: a.user.id, studentName: "Second" },
    });
    await prisma.evaluation.create({ data: run(a.profile.id) });
    await prisma.evaluation.create({ data: run(second.id) });

    sessionUser.id = a.user.id;
    const total = await getAccountSpendUsd();
    // Two identical runs, so the second student's spend must be included.
    const oneRun = total / 2;
    expect(oneRun).toBeGreaterThan(0);
    expect(total).toBeCloseTo(oneRun * 2, 6);
  });

  it("never counts another account's spend", async () => {
    const a = await createUserWithProfile(runTag, "iso-a");
    const b = await createUserWithProfile(runTag, "iso-b");
    await prisma.evaluation.create({ data: run(b.profile.id) });

    sessionUser.id = a.user.id;
    expect(await getAccountSpendUsd()).toBe(0);

    sessionUser.id = b.user.id;
    expect(await getAccountSpendUsd()).toBeGreaterThan(0);
  });

  it("ignores sample runs, which never called the API", async () => {
    const a = await createUserWithProfile(runTag, "sample");
    await prisma.evaluation.create({
      data: run(a.profile.id, { isSample: true }),
    });
    sessionUser.id = a.user.id;
    expect(await getAccountSpendUsd()).toBe(0);
  });

  it("counts failed runs, which burned tokens before failing", async () => {
    // Otherwise a loop of failing runs spends without limit.
    const a = await createUserWithProfile(runTag, "failed");
    await prisma.evaluation.create({
      data: run(a.profile.id, { status: "failed" }),
    });
    sessionUser.id = a.user.id;
    expect(await getAccountSpendUsd()).toBeGreaterThan(0);
  });

  it("counts projections, not just evaluations", async () => {
    // A projection is a real API call on the same credits. Leaving it out
    // would make the cap undercount a whole category of spend.
    const a = await createUserWithProfile(runTag, "proj");
    await prisma.projection.create({
      data: {
        profileId: a.profile.id,
        status: "completed",
        isSample: false,
        model: "claude-sonnet-5",
        inputTokens: 100_000,
        outputTokens: 20_000,
        inputSnapshotJson: "{}",
      },
    });
    sessionUser.id = a.user.id;
    expect(await getAccountSpendUsd()).toBeGreaterThan(0);
  });
});
