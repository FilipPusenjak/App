// Issuing and redeeming reset tokens against a real database.
//
// The unit tests cover the rules; these cover the things only a database can
// get wrong — what is actually persisted, what a second redemption does, and
// whether a reset leaves the account in a state its owner can log in to.
import { afterAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  consumeResetToken,
  issueResetToken,
  peekResetToken,
} from "@/lib/password-reset-store";
import { hashResetToken } from "@/lib/password-reset";
import { cleanupRun, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("reset");
const describeDb = hasTestDb ? describe : describe.skip;

/** A user with a known password, so "did the password change" is checkable. */
async function makeUser(label: string, password = "original-password") {
  const email = `${runTag}-${label}@example.test`;
  const user = await prisma.user.create({
    data: {
      email,
      name: `Test ${label}`,
      passwordHash: await bcrypt.hash(password, 10),
    },
  });
  return { user, email };
}

const reread = (id: string) =>
  prisma.user.findUniqueOrThrow({ where: { id } });

describeDb("issuing a reset token", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("returns null for an address with no account", async () => {
    expect(await issueResetToken(`${runTag}-nobody@example.test`)).toBeNull();
  });

  it("finds the account whatever case the address is typed in", async () => {
    // Emails are stored lowercased. Without normalizing here, the owner types
    // the address as the user wrote it to them and is told no such account.
    const { email } = await makeUser("case");
    expect(await issueResetToken(email.toUpperCase())).not.toBeNull();
  });

  it("NEVER stores the token itself", async () => {
    // The property the whole design rests on: a dump of this table must not
    // contain anything that can be pasted into a link.
    const { email, user } = await makeUser("plaintext");
    const issued = await issueResetToken(email);

    const rows = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(issued!.token);
    expect(rows[0]!.tokenHash).toBe(hashResetToken(issued!.token));
    expect(JSON.stringify(rows)).not.toContain(issued!.token);
  });

  it("kills the previous link when a new one is issued", async () => {
    // Otherwise every request leaves another working link alive and the TTL
    // stops bounding anything.
    const { email } = await makeUser("supersede");
    const first = await issueResetToken(email);
    const second = await issueResetToken(email);

    expect(await peekResetToken(first!.token)).toBe("used");
    expect(await peekResetToken(second!.token)).toBe("valid");
  });
});

describeDb("redeeming a reset token", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("changes the password to the new one", async () => {
    const { email, user } = await makeUser("happy");
    const issued = await issueResetToken(email);

    const outcome = await consumeResetToken(issued!.token, "a-brand-new-password");
    expect(outcome.ok).toBe(true);

    const after = await reread(user.id);
    expect(await bcrypt.compare("a-brand-new-password", after.passwordHash)).toBe(true);
    expect(await bcrypt.compare("original-password", after.passwordHash)).toBe(false);
  });

  it("stores the new password hashed, not in the clear", async () => {
    const { email, user } = await makeUser("hashing");
    const issued = await issueResetToken(email);
    await consumeResetToken(issued!.token, "another-new-password");

    const after = await reread(user.id);
    expect(after.passwordHash).not.toContain("another-new-password");
    expect(after.passwordHash.startsWith("$2")).toBe(true);
  });

  it("works exactly once", async () => {
    // A reset link forwarded, screenshotted or left in a chat must not be
    // redeemable a second time.
    const { email, user } = await makeUser("single-use");
    const issued = await issueResetToken(email);

    expect((await consumeResetToken(issued!.token, "first-new-password")).ok).toBe(true);

    const second = await consumeResetToken(issued!.token, "attacker-password");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.state).toBe("used");

    // And the second attempt changed nothing.
    const after = await reread(user.id);
    expect(await bcrypt.compare("first-new-password", after.passwordHash)).toBe(true);
    expect(await bcrypt.compare("attacker-password", after.passwordHash)).toBe(false);
  });

  it("refuses an expired token and leaves the password alone", async () => {
    const { email, user } = await makeUser("expired");
    const issued = await issueResetToken(email);
    await prisma.passwordResetToken.updateMany({
      where: { tokenHash: hashResetToken(issued!.token) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const outcome = await consumeResetToken(issued!.token, "too-late-password");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.state).toBe("expired");

    const after = await reread(user.id);
    expect(await bcrypt.compare("original-password", after.passwordHash)).toBe(true);
  });

  it("refuses a token that was never issued", async () => {
    const outcome = await consumeResetToken("not-a-real-token", "whatever-password");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.state).toBe("unknown");
  });

  it("clears a lockout, so the reset actually lets them back in", async () => {
    // The bug this prevents: a locked-out account refuses a CORRECT password
    // until the window passes. Resetting without clearing the counters leaves
    // someone who just proved control of their reset link still unable to log
    // in, with nothing on screen explaining why.
    const { email, user } = await makeUser("locked");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 9,
        lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const issued = await issueResetToken(email);
    expect((await consumeResetToken(issued!.token, "recovered-password")).ok).toBe(true);

    const after = await reread(user.id);
    expect(after.lockedUntil).toBeNull();
    expect(after.failedLoginAttempts).toBe(0);
  });

  it("does not touch anyone else's password", async () => {
    const { email, user } = await makeUser("mine");
    const other = await makeUser("theirs");
    const issued = await issueResetToken(email);

    await consumeResetToken(issued!.token, "only-mine-changes");

    const theirs = await reread(other.user.id);
    expect(await bcrypt.compare("original-password", theirs.passwordHash)).toBe(true);
    expect(await reread(user.id).then((u) => u.passwordHash)).not.toBe(
      theirs.passwordHash,
    );
  });
});

describeDb("peeking at a token without spending it", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("leaves the token usable, so rendering the page does not burn it", async () => {
    // The reset page checks the token before showing the form. If that check
    // consumed it, a refresh — or a browser prefetch — would break the link.
    const { email } = await makeUser("peek");
    const issued = await issueResetToken(email);

    expect(await peekResetToken(issued!.token)).toBe("valid");
    expect(await peekResetToken(issued!.token)).toBe("valid");
    expect((await consumeResetToken(issued!.token, "still-worked-password")).ok).toBe(
      true,
    );
  });

  it("reports an unknown token rather than throwing", async () => {
    expect(await peekResetToken("garbage")).toBe("unknown");
  });
});
