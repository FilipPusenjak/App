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

// What the (mocked) JWT session claims. null = no cookie at all. The version
// is what the token was minted under — every account starts at 0, so 0 is a
// token from a live sign-in; undefined is a token from before versions existed.
const claimed = vi.hoisted(() => ({
  userId: null as string | null,
  sessionVersion: 0 as number | undefined,
}));

vi.mock("@/lib/auth", () => ({
  auth: async () =>
    claimed.userId
      ? { user: { id: claimed.userId, sessionVersion: claimed.sessionVersion } }
      : null,
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

// The second thing a cookie is not sufficient for. A token carries the
// account's session version from the moment it was minted; setting a new
// password moves the account on, and every earlier token stops matching.
describe.skipIf(!hasTestDb)("session version against the database", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("a token minted under the current version -> signed in, without the version", async () => {
    const { user } = await createUserWithProfile(runTag, "current");
    claimed.userId = user.id;
    claimed.sessionVersion = 0;

    const current = await getCurrentDbUser();
    expect(current).toMatchObject({ id: user.id });
    expect(current).not.toHaveProperty("sessionVersion");
  });

  it("a token minted before the password was last set -> signed out", async () => {
    const { user } = await createUserWithProfile(runTag, "reset");
    claimed.userId = user.id;
    claimed.sessionVersion = 0;
    await expect(requireUserId()).resolves.toBe(user.id); // sanity: in before

    // What a password reset does to the row — see consumeResetToken. This
    // token, on whatever device, was minted under 0 and still says 0.
    await prisma.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
    });

    await expect(getCurrentUser()).resolves.toBeNull();
    await expect(requireUserId()).rejects.toThrow("Not authenticated");

    // A fresh sign-in after the reset carries the new version and is in.
    claimed.sessionVersion = 1;
    await expect(requireUserId()).resolves.toBe(user.id);
  });

  it("a token from before versions existed -> signed out", async () => {
    // One forced sign-in per device on the deploy that introduces this, rather
    // than a pre-existing session outliving the reset meant to end it.
    const { user } = await createUserWithProfile(runTag, "legacy");
    claimed.userId = user.id;
    claimed.sessionVersion = undefined;

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
