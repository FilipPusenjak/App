// Session-vs-database validation — the stale-JWT fix.
//
// Sessions are JWTs, and a JWT keeps asserting a user id long after the row
// behind it is gone (account deleted from another device; database reset
// underneath a dev server). Before the fix, that cookie produced a hard
// Prisma crash on every page. The rule now: a session pointing at a missing
// user is simply signed out. Auth.js itself is mocked; what's under test is
// the check AGAINST THE DATABASE.
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

// What the (mocked) JWT session claims. null = no cookie at all.
const claimed = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@/lib/auth", () => ({
  auth: async () =>
    claimed.userId ? { user: { id: claimed.userId } } : null,
}));

import { getCurrentDbUser, getCurrentUser, requireUserId } from "@/lib/session";

const runTag = makeRunTag("sess");

describe.skipIf(!hasTestDb)("session validation against the database", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("no session -> signed out", async () => {
    claimed.userId = null;
    await expect(getCurrentUser()).resolves.toBeNull();
    await expect(requireUserId()).rejects.toThrow("Not authenticated");
  });

  it("a valid session for an existing user -> their row, without the password hash", async () => {
    const { user } = await createUserWithProfile(runTag, "live");
    claimed.userId = user.id;

    const current = await getCurrentDbUser();
    expect(current).toMatchObject({ id: user.id, email: user.email });
    // The session helper's select must never widen to include credentials.
    expect(current).not.toHaveProperty("passwordHash");

    await expect(requireUserId()).resolves.toBe(user.id);
  });

  it("a session whose user was deleted -> signed out, not a crash", async () => {
    const { user } = await createUserWithProfile(runTag, "gone");
    claimed.userId = user.id;
    await expect(requireUserId()).resolves.toBe(user.id); // sanity: works while alive

    // The account disappears while the JWT is still live (deletion from
    // another device is exactly this).
    await prisma.user.delete({ where: { id: user.id } });

    await expect(getCurrentUser()).resolves.toBeNull();
    await expect(requireUserId()).rejects.toThrow("Not authenticated");
  });

  it("a session with a fabricated user id -> signed out", async () => {
    claimed.userId = "cnothinguptown0000000000";
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
