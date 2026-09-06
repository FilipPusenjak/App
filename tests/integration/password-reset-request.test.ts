// Asking for a reset link, against a real database.
//
// The property being defended is that the forgot-password form cannot be used
// to find out who has an account here. That is not a theoretical concern for
// this app: the users are mostly minors, and "does this address have an
// account on a college-admissions site" is exactly the question a form like
// this must refuse to answer.
//
// Behavioural rather than source-level, because the leak this prevents is not
// a missing call — it is a DIFFERENCE between two responses, and the only way
// to check for a difference is to produce both.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";
import {
  RESET_REQUESTED_MESSAGE,
  RESET_REQUESTS_PER_HOUR,
} from "@/lib/password-reset";

const runTag = makeRunTag("reset-request");

// No provider configured in tests. sendEmail already no-ops in that state, but
// stubbing it makes the assertion about WHO WOULD BE MAILED rather than about
// what an unconfigured deployment happens to do.
const sent: { to: string; subject: string }[] = [];
vi.mock("@/lib/email/send", () => ({
  sendEmail: async (message: { to: string; subject: string }) => {
    sent.push({ to: message.to, subject: message.subject });
    return { ok: true, id: "test" };
  },
}));

// The module under test shares a file with the action that signs somebody in
// after a successful reset, which drags next-auth into a plain node runtime
// where its own imports do not resolve. Nothing here exercises that path.
vi.mock("@/lib/auth", () => ({ signIn: async () => undefined }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));

const { requestPasswordResetAction } = await import(
  "@/app/actions/password-reset"
);

function ask(email: string) {
  const form = new FormData();
  form.set("email", email);
  return requestPasswordResetAction(undefined, form);
}

/** The action only sends when the deployment is configured to. */
function configured<T>(body: () => Promise<T>): Promise<T> {
  const saved = {
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    url: process.env.APP_URL,
  };
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "hello@example.com";
  process.env.APP_URL = "https://example.com";
  return body().finally(() => {
    if (saved.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved.key;
    if (saved.from === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = saved.from;
    if (saved.url === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved.url;
  });
}

describe.skipIf(!hasTestDb)("asking for a password reset link", () => {
  let email = "";

  beforeEach(async () => {
    sent.length = 0;
    const { user } = await createUserWithProfile(
      runTag,
      `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    email = user.email;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  it("answers a registered and an unregistered address identically", async () => {
    // THE test in this file. Any difference here — wording, a field error, an
    // extra key — is a way to enumerate accounts.
    const registered = await configured(() => ask(email));
    const unknown = await configured(() => ask("nobody-at-all@example.test"));
    expect(registered).toEqual(unknown);
    expect(registered?.notice).toBe(RESET_REQUESTED_MESSAGE);
  });

  it("mails only the address that actually has an account", async () => {
    await configured(() => ask(email));
    await configured(() => ask("nobody-at-all@example.test"));
    expect(sent.map((s) => s.to)).toEqual([email]);
  });

  it("issues a token for a real account", async () => {
    await configured(() => ask(email));
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const tokens = await prisma.passwordResetToken.count({
      where: { userId: user.id },
    });
    expect(tokens).toBe(1);
  });

  it("rejects a malformed address, which is about typing not about accounts", () => {
    // The one thing worth answering differently: it describes what they typed,
    // and reveals nothing about who is registered.
    return configured(async () => {
      const result = await ask("not-an-email");
      expect(result?.fieldErrors?.email).toBeTruthy();
      expect(result?.notice).toBeUndefined();
      expect(sent).toHaveLength(0);
    });
  });

  it("stops after the hourly allowance, still without saying so", async () => {
    // Otherwise the form is a way to flood somebody's inbox.
    await configured(async () => {
      for (let i = 0; i < RESET_REQUESTS_PER_HOUR + 2; i += 1) await ask(email);
    });
    expect(sent).toHaveLength(RESET_REQUESTS_PER_HOUR);

    const throttled = await configured(() => ask(email));
    expect(throttled?.notice).toBe(RESET_REQUESTED_MESSAGE);
  });

  it("sends nothing at all when the deployment has no provider", async () => {
    // The state this deployment is actually in. It must be silent, not broken.
    const result = await ask(email);
    expect(result?.notice).toBe(RESET_REQUESTED_MESSAGE);
    expect(sent).toHaveLength(0);
  });

  it("mints no token when it cannot send one", async () => {
    // A token nobody will ever receive is a live credential for nothing.
    await ask(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(
      await prisma.passwordResetToken.count({ where: { userId: user.id } }),
    ).toBe(0);
  });
});
