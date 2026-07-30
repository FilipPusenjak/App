// Login brute-force protection — state lives on the User row (a serverless
// instance's memory would enforce nothing), so these run against the database.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  clearFailedLogins,
  isLockedOut,
  recordFailedLogin,
} from "@/lib/login-throttle";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("lock");

describe.skipIf(!hasTestDb)("login throttle", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  describe("isLockedOut (pure logic)", () => {
    it("false when never locked", () => {
      expect(isLockedOut({ lockedUntil: null })).toBe(false);
    });
    it("false once the lock has expired", () => {
      expect(isLockedOut({ lockedUntil: new Date(Date.now() - 1000) })).toBe(
        false,
      );
    });
    it("true while the lock is live", () => {
      expect(isLockedOut({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(
        true,
      );
    });
  });

  it("counts failures without locking below the threshold", async () => {
    const { user } = await createUserWithProfile(runTag, "counter");
    await recordFailedLogin({ id: user.id, failedLoginAttempts: 0 });
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.failedLoginAttempts).toBe(1);
    expect(after.lockedUntil).toBeNull();
    expect(isLockedOut(after)).toBe(false);
  });

  it(`locks the account on failure #${MAX_FAILED_LOGINS} for ~${LOCKOUT_MINUTES} minutes`, async () => {
    const { user } = await createUserWithProfile(runTag, "locked");

    // Replay the real sequence: authorize() re-reads the user on each attempt.
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      await recordFailedLogin(current);
    }

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(isLockedOut(after)).toBe(true);
    expect(after.failedLoginAttempts).toBe(0); // counter resets when the lock sets

    const remainingMs = after.lockedUntil!.getTime() - Date.now();
    expect(remainingMs).toBeGreaterThan(0);
    expect(remainingMs).toBeLessThanOrEqual(LOCKOUT_MINUTES * 60 * 1000);
  });

  it("clears the counter and the lock after a successful login", async () => {
    const { user } = await createUserWithProfile(runTag, "cleared");
    const primed = await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 3,
        lockedUntil: new Date(Date.now() + 60_000),
      },
    });

    await clearFailedLogins(primed);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.failedLoginAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });
});
