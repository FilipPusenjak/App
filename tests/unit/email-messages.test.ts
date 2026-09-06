// What the emails say, and what they must never say.
//
// These go to teenagers about their university applications. The constraints
// below are the same ones the evaluations themselves are held to, plus the
// ones that only apply once you are arriving in somebody's inbox uninvited.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkInNudgeEmail, passwordResetEmail } from "@/lib/email/messages";
import { findBannedPhrasing } from "@/lib/validation/tiers";

const reset = passwordResetEmail({
  to: "sam@example.com",
  resetUrl: "https://a.com/reset-password?token=abc",
  ttlMinutes: 60,
});

const nudge = checkInNudgeEmail({
  to: "sam@example.com",
  name: "Sam",
  daysSince: 30,
  appUrl: "https://a.com",
  unsubscribeToken: "tok",
});

describe("the password reset email", () => {
  it("carries the link in both parts", () => {
    expect(reset.text).toContain("https://a.com/reset-password?token=abc");
    expect(reset.html).toContain("https://a.com/reset-password?token=abc");
  });

  it("repeats the link as plain text in the HTML part", () => {
    // A client that strips the anchor otherwise leaves somebody reading about
    // a link they cannot reach.
    const withoutAnchors = reset.html!.replace(/<a[\s\S]*?<\/a>/g, "");
    expect(withoutAnchors).toContain("https://a.com/reset-password?token=abc");
  });

  it("says how long it lasts", () => {
    // The token really does expire. Somebody opening it the next morning
    // needs to know why it failed rather than conclude the app is broken.
    expect(reset.text).toContain("60 minutes");
  });

  it("tells an unexpected recipient that nothing has happened yet", () => {
    expect(reset.text).toMatch(/wasn't you/i);
    expect(reset.text).toMatch(/password has not changed/i);
  });

  it("reports nothing about who asked or from where", () => {
    // An unrequested reset is a typo or somebody probing, and neither is
    // improved by reporting an IP address to a fifteen-year-old.
    expect(reset.text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(reset.text.toLowerCase()).not.toContain("ip address");
  });

  it("carries no unsubscribe header", () => {
    // Transactional. Honouring an unsubscribe here would lock somebody out of
    // their own account.
    expect(reset.unsubscribeUrl).toBeUndefined();
  });
});

describe("the check-in reminder", () => {
  it("says how long it has been, and where to go", () => {
    expect(nudge.text).toContain("30 days");
    expect(nudge.text).toContain("https://a.com/evaluations");
  });

  it("uses their name when there is one, and reads properly without", () => {
    expect(nudge.text.startsWith("Sam, it's been")).toBe(true);
    const anonymous = checkInNudgeEmail({
      to: "x@example.com",
      name: null,
      daysSince: 20,
      appUrl: "https://a.com",
      unsubscribeToken: "tok",
    });
    expect(anonymous.text.startsWith("It's been 20 days")).toBe(true);
  });

  it("carries an unsubscribe link in the body AND in the headers", () => {
    // The body link is courtesy; the header is what puts the control in the
    // mail client's chrome, and its absence is read as a spam signal.
    expect(nudge.text).toContain("https://a.com/unsubscribe?token=tok");
    expect(nudge.html).toContain("https://a.com/unsubscribe?token=tok");
    expect(nudge.unsubscribeUrl).toBe("https://a.com/api/unsubscribe?token=tok");
  });

  it("never states odds of admission, like everything else here", () => {
    // The SAME check a model's narrative is held to, rather than a second
    // list beside it that could drift.
    expect(findBannedPhrasing(nudge.text)).toEqual([]);
    expect(findBannedPhrasing(nudge.html)).toEqual([]);
    expect(findBannedPhrasing(nudge.subject)).toEqual([]);
  });

  it("invents no deadline and no urgency", () => {
    // The one thing that would make this app feel like everything else
    // shouting at a seventeen-year-old about their future.
    const body = `${nudge.text} ${nudge.html}`.toLowerCase();
    for (const word of ["urgent", "act now", "don't miss", "last chance", "hurry", "deadline"]) {
      expect(body).not.toContain(word);
    }
    expect(nudge.text).not.toContain("!");
  });

  it("does not claim anything about their profile it cannot know", () => {
    // It knows how long it has been. It does not know that anything improved,
    // slipped, or changed at all.
    const body = nudge.text.toLowerCase();
    expect(body).not.toContain("improved");
    expect(body).not.toContain("you're falling behind");
  });

  it("is honest that a check-in is often free", () => {
    // True — the route runs a deterministic pass first and charges nothing
    // when nothing material moved. Worth saying, because "this costs a credit"
    // is the reason somebody would not bother.
    expect(nudge.text).toMatch(/costs? nothing/i);
  });
});

describe("both messages", () => {
  it("have a plain-text part that stands on its own", () => {
    // The text part is the message, not a fallback for it.
    for (const message of [reset, nudge]) {
      expect(message.text.length).toBeGreaterThan(80);
      expect(message.text).not.toContain("<");
    }
  });

  it("escape anything interpolated into the HTML", () => {
    const nasty = checkInNudgeEmail({
      to: "x@example.com",
      name: '"><script>alert(1)</script>',
      daysSince: 20,
      appUrl: "https://a.com",
      unsubscribeToken: "tok",
    });
    expect(nasty.html).not.toContain("<script>");
    expect(nasty.html).toContain("&lt;script&gt;");
  });

  it("are built without touching the network or the database", () => {
    // Pure, so the wording can be argued with in a test rather than by
    // sending mail to somebody.
    const src = readFileSync(join(process.cwd(), "lib/email/messages.ts"), "utf8");
    expect(src).not.toMatch(/prisma|fetch\(/);
  });
});
