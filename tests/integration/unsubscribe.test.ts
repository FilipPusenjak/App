// Turning off reminders, against a real database.
//
// An unsubscribe that does not work is how a sender gets reported as spam, so
// the properties worth proving are the awkward ones: that it works without a
// session, that a second click is not an error, and that it switches off
// exactly one thing and touches nothing else about the account.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";
import {
  markReminderSent,
  unsubscribeByToken,
  unsubscribeTokenFor,
} from "@/lib/email/reminders-store";

const runTag = makeRunTag("unsub");

const newUser = (label: string) =>
  createUserWithProfile(runTag, `${label}${Date.now()}${Math.random().toString(36).slice(2, 6)}`);

describe.skipIf(!hasTestDb)("unsubscribing from check-in reminders", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("mints a token on first use and reuses it afterwards", async () => {
    // A new token per email would leave every earlier message carrying a dead
    // unsubscribe link.
    const { user } = await newUser("mint");
    const first = await unsubscribeTokenFor(user.id);
    const second = await unsubscribeTokenFor(user.id);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(42);
  });

  it("stops the reminders", async () => {
    const { user } = await newUser("stop");
    const token = await unsubscribeTokenFor(user.id);

    expect(await unsubscribeByToken(token)).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.remindersOptOutAt).not.toBeNull();
  });

  it("is idempotent, and keeps the original opt-out time", async () => {
    // Mail clients prefetch links, people click twice, and messages get
    // forwarded. None of that may read as a failure, and none of it should
    // rewrite when they actually opted out.
    const { user } = await newUser("twice");
    const token = await unsubscribeTokenFor(user.id);

    await unsubscribeByToken(token);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(await unsubscribeByToken(token)).toBe(true);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(second.remindersOptOutAt?.getTime()).toBe(
      first.remindersOptOutAt?.getTime(),
    );
  });

  it("keeps working after the first click, rather than burning the token", async () => {
    const { user } = await newUser("reuse");
    const token = await unsubscribeTokenFor(user.id);
    await unsubscribeByToken(token);

    const still = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(still.unsubscribeToken).toBe(token);
  });

  it("rejects a token nobody holds, without erroring", async () => {
    expect(await unsubscribeByToken("not-a-real-token")).toBe(false);
  });

  it("rejects an empty token rather than matching the first null row", async () => {
    // The failure this guards against: a blank token finding an account that
    // simply has no token yet, and unsubscribing a stranger.
    await newUser("blank");
    expect(await unsubscribeByToken("")).toBe(false);
    expect(await unsubscribeByToken("   ")).toBe(false);
  });

  it("changes nothing else about the account", async () => {
    // It is an email preference, not a deletion and not a downgrade.
    const { user, profile } = await newUser("scope");
    const token = await unsubscribeTokenFor(user.id);
    await markReminderSent(user.id);
    await unsubscribeByToken(token);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { profiles: true },
    });
    expect(after.email).toBe(user.email);
    expect(after.passwordHash).toBe(user.passwordHash);
    expect(after.profiles.map((p) => p.id)).toContain(profile.id);
  });

  it("records a send only when told to, and that is what paces the next one", async () => {
    const { user } = await newUser("sent");
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(before.remindersLastSentAt).toBeNull();

    await markReminderSent(user.id);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.remindersLastSentAt).not.toBeNull();
  });
});
