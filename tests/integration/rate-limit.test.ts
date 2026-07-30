// The evaluation rate limiter — database-backed on purpose, so it has to be
// tested against the database: the cooldown and the hourly cap are enforced
// by real queries whose filters (per-user scoping, samples excluded) are
// exactly what these tests exercise.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  COOLDOWN_SECONDS,
  MAX_PER_HOUR,
  evaluationRateLimiter,
} from "@/lib/rate-limit";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("rate");

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

async function createEvaluationAt(
  profileId: string,
  createdAt: Date,
  isSample = false,
) {
  return prisma.evaluation.create({
    data: {
      profileId,
      status: "completed",
      isSample,
      inputSnapshotJson: "{}",
      createdAt,
    },
  });
}

describe.skipIf(!hasTestDb)("evaluationRateLimiter", () => {
  let userId: string;
  let profileId: string;

  beforeEach(async () => {
    // A brand-new user per test: the limiter's state IS the evaluation rows.
    const { user, profile } = await createUserWithProfile(
      runTag,
      `u${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    userId = user.id;
    profileId = profile.id;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("allows a user with no evaluations", async () => {
    await expect(evaluationRateLimiter.check(userId)).resolves.toEqual({
      ok: true,
    });
  });

  it("enforces the cooldown right after a run", async () => {
    await createEvaluationAt(profileId, secondsAgo(2));
    const result = await evaluationRateLimiter.check(userId);
    expect(result).toMatchObject({ ok: false, reason: "cooldown" });
    if (!result.ok) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(COOLDOWN_SECONDS);
    }
  });

  it("applies the cooldown to sample runs too — it protects the endpoint, not just spend", async () => {
    await createEvaluationAt(profileId, secondsAgo(2), true);
    await expect(evaluationRateLimiter.check(userId)).resolves.toMatchObject({
      ok: false,
      reason: "cooldown",
    });
  });

  it("allows again once the cooldown has passed", async () => {
    await createEvaluationAt(profileId, secondsAgo(COOLDOWN_SECONDS + 5));
    await expect(evaluationRateLimiter.check(userId)).resolves.toEqual({
      ok: true,
    });
  });

  it("blocks after MAX_PER_HOUR billable runs in the rolling hour", async () => {
    // Oldest first, most recent safely past the cooldown.
    for (let i = 0; i < MAX_PER_HOUR; i++) {
      await createEvaluationAt(
        profileId,
        secondsAgo(30 * 60 - i * 60), // 30min ago, 29min ago, ...
      );
    }
    const result = await evaluationRateLimiter.check(userId);
    expect(result).toMatchObject({ ok: false, reason: "hourly" });
    if (!result.ok) {
      // Frees up when the oldest run leaves the window — ~30 minutes.
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(60 * 60);
    }
  });

  it("does NOT count sample runs against the hourly cap", async () => {
    for (let i = 0; i < MAX_PER_HOUR; i++) {
      await createEvaluationAt(
        profileId,
        secondsAgo(30 * 60 - i * 60),
        true, // all samples
      );
    }
    await expect(evaluationRateLimiter.check(userId)).resolves.toEqual({
      ok: true,
    });
  });

  it("ignores billable runs older than the window", async () => {
    for (let i = 0; i < MAX_PER_HOUR; i++) {
      await createEvaluationAt(profileId, secondsAgo(2 * 60 * 60 + i * 60));
    }
    await expect(evaluationRateLimiter.check(userId)).resolves.toEqual({
      ok: true,
    });
  });

  it("is scoped per user — someone else's spending never blocks you", async () => {
    const other = await createUserWithProfile(runTag, `other${Date.now()}`);
    for (let i = 0; i < MAX_PER_HOUR; i++) {
      await createEvaluationAt(
        other.profile.id,
        secondsAgo(30 * 60 - i * 60),
      );
    }
    // `other` is over the cap; our user is untouched.
    await expect(
      evaluationRateLimiter.check(other.user.id),
    ).resolves.toMatchObject({ ok: false });
    await expect(evaluationRateLimiter.check(userId)).resolves.toEqual({
      ok: true,
    });
  });
});
