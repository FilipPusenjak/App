// Whether this deployment sends email, and what it does when it cannot.
//
// The whole point of these is that "not configured" is a NORMAL state with
// correct behaviour, not a broken one. The deployment this was written for has
// no verified sending domain, so every rule below describes what happens on it
// today.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canSendEmail,
  emailConfig,
  missingEmailConfig,
  resolveAppUrl,
} from "@/lib/email/config";

const KEYS = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_URL",
  "AUTH_URL",
  "NEXTAUTH_URL",
  "VERCEL_URL",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const configured = () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "CourseChart <hello@example.com>";
  process.env.APP_URL = "https://example.com";
};

describe("deciding whether this deployment can send", () => {
  it("cannot, with nothing set", () => {
    expect(canSendEmail()).toBe(false);
    expect(emailConfig()).toBeNull();
  });

  it("can, with all three set", () => {
    configured();
    expect(canSendEmail()).toBe(true);
  });

  it("refuses a key with no From address", () => {
    // Resend rejects it anyway; failing here means the reason is visible
    // rather than buried in a provider error on a scheduled run.
    process.env.RESEND_API_KEY = "re_test";
    process.env.APP_URL = "https://example.com";
    expect(canSendEmail()).toBe(false);
  });

  it("refuses to send when it does not know its own URL", () => {
    // A password reset with a broken link IS the whole message. Sending one
    // that goes nowhere is worse than sending nothing.
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "hello@example.com";
    expect(canSendEmail()).toBe(false);
  });

  it("treats whitespace as unset", () => {
    process.env.RESEND_API_KEY = "   ";
    process.env.EMAIL_FROM = "hello@example.com";
    process.env.APP_URL = "https://example.com";
    expect(canSendEmail()).toBe(false);
  });

  it("names what is missing, rather than saying 'not configured'", () => {
    // The operator reading this is trying to find out which one they forgot.
    expect(missingEmailConfig()).toEqual([
      "RESEND_API_KEY",
      "EMAIL_FROM",
      "APP_URL",
    ]);
    configured();
    expect(missingEmailConfig()).toEqual([]);
  });
});

describe("working out where the app is served from", () => {
  it("prefers an explicit APP_URL", () => {
    expect(
      resolveAppUrl({ APP_URL: "https://a.com", NEXTAUTH_URL: "https://b.com" }),
    ).toBe("https://a.com");
  });

  it("falls back through the auth variables, then Vercel's", () => {
    expect(resolveAppUrl({ AUTH_URL: "https://a.com" })).toBe("https://a.com");
    expect(resolveAppUrl({ NEXTAUTH_URL: "https://b.com" })).toBe("https://b.com");
    expect(resolveAppUrl({ VERCEL_URL: "c.vercel.app" })).toBe("https://c.vercel.app");
  });

  it("strips a trailing slash, so links do not get a double one", () => {
    expect(resolveAppUrl({ APP_URL: "https://a.com/" })).toBe("https://a.com");
  });

  it("returns null rather than guessing localhost", () => {
    // The address of the one machine the recipient is definitely not using.
    expect(resolveAppUrl({})).toBeNull();
  });
});
