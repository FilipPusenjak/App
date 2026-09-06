// Who gets a reminder email, and — mostly — who does not.
//
// Every rule here is a reason NOT to send. The recipients are students, mostly
// minors, and unrequested mail is the fastest way to become the thing they
// mute. So these tests are written from the position that sending is the
// exception that has to be justified.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_REMINDERS_PER_RUN,
  REMIND_AFTER_DAYS,
  REMIND_COOLDOWN_DAYS,
  mintUnsubscribeToken,
  oneClickUnsubscribeUrl,
  reminderDecision,
  remindersToSend,
  unsubscribeUrl,
  type ReminderCandidate,
} from "@/lib/email/reminders";

const NOW = new Date("2026-09-06T12:00:00.000Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/** Somebody who SHOULD be reminded, so each test can spoil one thing. */
const due = (over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  userId: "u1",
  email: "student@example.com",
  name: "Sam",
  lastRunAt: daysAgo(30),
  hasBaseline: true,
  canRun: true,
  optedOutAt: null,
  lastRemindedAt: null,
  ...over,
});

describe("the baseline case", () => {
  it("reminds somebody who ran once and has been gone a month", () => {
    const decision = reminderDecision(due(), NOW);
    expect(decision.send).toBe(true);
    if (decision.send) expect(decision.daysSince).toBe(30);
  });
});

describe("reasons not to send", () => {
  it("never mails somebody who opted out", () => {
    const decision = reminderDecision(due({ optedOutAt: daysAgo(200) }), NOW);
    expect(decision).toEqual({ send: false, reason: "opted-out" });
  });

  it("opting out beats every other reason to send", () => {
    // The one rule that must not be overrulable by anything below it.
    const decision = reminderDecision(
      due({ optedOutAt: daysAgo(1), lastRunAt: daysAgo(3650) }),
      NOW,
    );
    expect(decision.send).toBe(false);
  });

  it("does not mail somebody who has never run anything", () => {
    // A check-in compares against a previous evaluation. With no baseline the
    // mail invites them to press a button that will refuse them.
    expect(
      reminderDecision(due({ hasBaseline: false, lastRunAt: null }), NOW),
    ).toEqual({ send: false, reason: "no-baseline" });
  });

  it("does not mail a profile that cannot be evaluated any more", () => {
    // Targets deleted, or the profile emptied: the button is disabled, and
    // sending somebody to it wastes their time and our credibility.
    expect(reminderDecision(due({ canRun: false }), NOW)).toEqual({
      send: false,
      reason: "not-evaluable",
    });
  });

  it("does not mail somebody who ran recently", () => {
    expect(reminderDecision(due({ lastRunAt: daysAgo(3) }), NOW)).toEqual({
      send: false,
      reason: "too-soon",
    });
  });

  it("waits the full interval before the first reminder", () => {
    // The day before the threshold is still too soon; the day of it is not.
    expect(
      reminderDecision(due({ lastRunAt: daysAgo(REMIND_AFTER_DAYS - 1) }), NOW).send,
    ).toBe(false);
    expect(
      reminderDecision(due({ lastRunAt: daysAgo(REMIND_AFTER_DAYS) }), NOW).send,
    ).toBe(true);
  });

  it("does not mail somebody it mailed days ago", () => {
    // Without this, one ignored reminder becomes a reminder every single run.
    expect(
      reminderDecision(due({ lastRemindedAt: daysAgo(2) }), NOW),
    ).toEqual({ send: false, reason: "reminded-recently" });
  });

  it("will mail again once the cooling-off period has passed", () => {
    expect(
      reminderDecision(due({ lastRemindedAt: daysAgo(REMIND_COOLDOWN_DAYS) }), NOW)
        .send,
    ).toBe(true);
  });

  it("cools off for longer than it waits, so one ignored mail is not a drumbeat", () => {
    expect(REMIND_COOLDOWN_DAYS).toBeGreaterThan(REMIND_AFTER_DAYS);
  });
});

describe("choosing who to send to in one run", () => {
  it("returns only the people who are due", () => {
    const list = remindersToSend(
      [
        due({ userId: "yes" }),
        due({ userId: "optedout", optedOutAt: daysAgo(1) }),
        due({ userId: "recent", lastRunAt: daysAgo(1) }),
      ],
      NOW,
    );
    expect(list.map((r) => r.candidate.userId)).toEqual(["yes"]);
  });

  it("caps a single run", () => {
    // A ceiling on the blast radius of a rule that turns out to be wrong.
    const many = Array.from({ length: MAX_REMINDERS_PER_RUN + 25 }, (_, i) =>
      due({ userId: `u${i}` }),
    );
    expect(remindersToSend(many, NOW)).toHaveLength(MAX_REMINDERS_PER_RUN);
  });

  it("keeps the longest-silent people when the cap bites", () => {
    // If it has to drop somebody, dropping the person who left yesterday is
    // better than dropping the one who left a year ago.
    const many = Array.from({ length: MAX_REMINDERS_PER_RUN + 1 }, (_, i) =>
      due({ userId: `u${i}`, lastRunAt: daysAgo(20 + i) }),
    );
    const chosen = remindersToSend(many, NOW);
    expect(chosen[0]!.daysSince).toBeGreaterThan(
      chosen[chosen.length - 1]!.daysSince,
    );
    expect(chosen.map((c) => c.candidate.userId)).not.toContain("u0");
  });
});

describe("unsubscribe links", () => {
  it("mints tokens nobody is going to guess", () => {
    const a = mintUnsubscribeToken();
    const b = mintUnsubscribeToken();
    expect(a).not.toBe(b);
    // 32 random bytes, base64url.
    expect(a.length).toBeGreaterThanOrEqual(42);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("builds a human link and a one-click link from the same token", () => {
    expect(unsubscribeUrl("https://a.com", "tok")).toBe(
      "https://a.com/unsubscribe?token=tok",
    );
    // The header URL must reach something that accepts POST, which a page
    // cannot — hence the separate route.
    expect(oneClickUnsubscribeUrl("https://a.com", "tok")).toBe(
      "https://a.com/api/unsubscribe?token=tok",
    );
  });

  it("escapes a token that would otherwise break the URL", () => {
    expect(unsubscribeUrl("https://a.com", "a+b/c=")).toContain("a%2Bb%2Fc%3D");
  });
});

describe("the route that sends them", () => {
  const src = readFileSync(
    join(process.cwd(), "app/api/reminders/route.ts"),
    "utf8",
  );

  it("is reachable only by the scheduler, and fails closed", () => {
    // An unset CRON_SECRET must mean no request is the scheduler, rather than
    // every request being it.
    expect(src).toMatch(/CRON_SECRET/);
    expect(src).toMatch(/secret && secret\.trim\(\)/);
  });

  it("has no signed-in fallback, unlike the triage route", () => {
    // This one sends mail to other people. No path to it should exist that
    // somebody can reach by visiting a URL.
    expect(src).not.toMatch(/getCurrentUser|requireUserId/);
  });

  it("records the send only after the provider accepted it", () => {
    // The ordering that makes the job safe to run twice or to die halfway.
    const sendIndex = src.indexOf("sendEmail(");
    const markIndex = src.indexOf("markReminderSent(");
    expect(sendIndex).toBeGreaterThan(-1);
    expect(markIndex).toBeGreaterThan(sendIndex);
    expect(src).toMatch(/if \(result\.ok\)[\s\S]*?markReminderSent/);
  });

  it("mints the unsubscribe token before sending, never after", () => {
    // No reminder may go out without a working way to stop the next one.
    expect(src.indexOf("unsubscribeTokenFor(")).toBeLessThan(
      src.indexOf("sendEmail("),
    );
  });
});
