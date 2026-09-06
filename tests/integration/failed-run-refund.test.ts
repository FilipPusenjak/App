// Giving a failed run back — against a real database, because the whole
// change is about what the WRITES do.
//
// The rule itself (refundsFailedRun) is pure and tested in tests/unit. What
// cannot be tested there is the part that actually costs somebody something:
// that the credit comes back, that the row stops counting toward the interval,
// and that a second failure in a row does neither. Those are three writes and
// a query, and the only honest way to check them is to make them.
import { afterAll, describe, expect, it } from "vitest";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";
import { prisma } from "@/lib/db";
import {
  lastRunAtByKind,
  refundFailedRun,
} from "@/lib/billing/quota-account";

const runTag = makeRunTag("refund");

/** A finished Deep Review, so the run after it is a FIRST failure. */
async function completedRun(profileId: string, minutesAgo: number) {
  return prisma.evaluation.create({
    data: {
      profileId,
      type: "DEEP_REVIEW",
      status: "completed",
      promptVersion: "evaluation/v11",
      isSample: false,
      inputSnapshotJson: "{}",
      createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
    },
  });
}

async function failedRun(profileId: string, minutesAgo: number) {
  return prisma.evaluation.create({
    data: {
      profileId,
      type: "DEEP_REVIEW",
      status: "failed",
      error: "ran out of room",
      promptVersion: "evaluation/v11",
      isSample: false,
      inputSnapshotJson: "{}",
      createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
    },
  });
}

describe.skipIf(!hasTestDb)("a failed run is given back", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("returns the credit the run was authorized with", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "credit");
    // authorizeRun already spent it, which is why the balance starts at zero.
    await prisma.runCredit.create({
      data: { userId: user.id, kind: "DEEP_REVIEW", remaining: 0 },
    });
    await completedRun(profile.id, 60);
    const failure = await failedRun(profile.id, 1);

    const refunded = await refundFailedRun({
      userId: user.id,
      kind: "DEEP_REVIEW",
      runId: failure.id,
      usingCredit: true,
    });

    expect(refunded).toBe(true);
    const credit = await prisma.runCredit.findUnique({
      where: { userId_kind: { userId: user.id, kind: "DEEP_REVIEW" } },
    });
    expect(credit?.remaining).toBe(1);
  });

  it("stops the failed run from starting the interval", async () => {
    // The half that actually blocks a retry on Plus. A refund that returned
    // the credit but left this date standing would tell somebody to wait a
    // month for the run they were just given back.
    const { user, profile } = await createUserWithProfile(runTag, "interval");
    const completed = await completedRun(profile.id, 120);
    const failure = await failedRun(profile.id, 1);

    // Before the refund the failure is the newest run, so it sets the date.
    const before = await lastRunAtByKind(user.id);
    expect(before.DEEP_REVIEW?.getTime()).toBe(failure.createdAt.getTime());

    await refundFailedRun({
      userId: user.id,
      kind: "DEEP_REVIEW",
      runId: failure.id,
      usingCredit: false,
    });

    const after = await lastRunAtByKind(user.id);
    expect(after.DEEP_REVIEW?.getTime()).toBe(completed.createdAt.getTime());
  });

  it("does not refund a second failure in succession", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "second");
    await prisma.runCredit.create({
      data: { userId: user.id, kind: "DEEP_REVIEW", remaining: 0 },
    });
    await completedRun(profile.id, 180);
    const first = await failedRun(profile.id, 60);
    await refundFailedRun({
      userId: user.id,
      kind: "DEEP_REVIEW",
      runId: first.id,
      usingCredit: true,
    });

    // They spend the refunded credit on a retry, and it fails the same way.
    const second = await failedRun(profile.id, 1);
    const refunded = await refundFailedRun({
      userId: user.id,
      kind: "DEEP_REVIEW",
      runId: second.id,
      usingCredit: true,
    });

    expect(refunded).toBe(false);
    const credit = await prisma.runCredit.findUnique({
      where: { userId_kind: { userId: user.id, kind: "DEEP_REVIEW" } },
    });
    // One back from the first failure, and that is all.
    expect(credit?.remaining).toBe(1);
    // And the unrefunded failure DOES start the interval.
    const after = await lastRunAtByKind(user.id);
    expect(after.DEEP_REVIEW?.getTime()).toBe(second.createdAt.getTime());
  });

  it("treats a failure after a success as a first failure again", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "recovered");
    await completedRun(profile.id, 180);
    const failed = await failedRun(profile.id, 120);
    await refundFailedRun({
      userId: user.id,
      kind: "DEEP_REVIEW",
      runId: failed.id,
      usingCredit: false,
    });
    await completedRun(profile.id, 60); // the retry worked

    const later = await failedRun(profile.id, 1);
    expect(
      await refundFailedRun({
        userId: user.id,
        kind: "DEEP_REVIEW",
        runId: later.id,
        usingCredit: false,
      }),
    ).toBe(true);
  });

  it("does not invent a credit for an account that never had one", async () => {
    // Somebody on Plus fails a run: there is no RunCredit row at all, and the
    // refund must still mark the row rather than throwing on the error path.
    const { user, profile } = await createUserWithProfile(runTag, "nocredit");
    const failure = await failedRun(profile.id, 1);

    expect(
      await refundFailedRun({
        userId: user.id,
        kind: "DEEP_REVIEW",
        runId: failure.id,
        usingCredit: false,
      }),
    ).toBe(true);
    expect(
      await prisma.runCredit.findMany({ where: { userId: user.id } }),
    ).toEqual([]);
    const row = await prisma.evaluation.findUniqueOrThrow({
      where: { id: failure.id },
    });
    expect(row.quotaRefunded).toBe(true);
  });

  it("keeps a check-in's history separate from a Deep Review's", async () => {
    // The two share a table. If the "what came before" lookup mixed them, a
    // failed check-in after a failed review would read as a second failure and
    // be charged when it is the first of its kind.
    const { user, profile } = await createUserWithProfile(runTag, "kinds");
    await prisma.evaluation.create({
      data: {
        profileId: profile.id,
        type: "DEEP_REVIEW",
        status: "failed",
        promptVersion: "evaluation/v11",
        isSample: false,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const checkIn = await prisma.evaluation.create({
      data: {
        profileId: profile.id,
        type: "CHECK_IN",
        status: "failed",
        promptVersion: "check-in/v3",
        isSample: false,
        createdAt: new Date(),
      },
    });

    expect(
      await refundFailedRun({
        userId: user.id,
        kind: "CHECK_IN",
        runId: checkIn.id,
        usingCredit: false,
      }),
    ).toBe(true);
  });
});
