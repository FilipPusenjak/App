// The triage digest: when it goes, and what it is allowed to say.
//
// Two separate risks, and the tests split along them.
//
// The first is a mail nobody reads. A digest that arrives weekly restating the
// same six students becomes the thing that gets filtered, and a filtered digest
// is worse than none — it means the week something genuinely moved, nobody saw
// it. So the send rule is about NEWS, and most of these are about proving it
// stays that way.
//
// The second is worse and quieter: a digest that discloses more about a student
// than the counselor's login would. Mail is forwarded, quoted, synced to phones
// and read over shoulders, and the student consented to a counselor reading
// their file in an app — not to their readiness score sitting in an inbox.
import { describe, expect, it } from "vitest";
import {
  DIGEST_COOLDOWN_DAYS,
  DIGEST_STUDENT_LIMIT,
  MAX_DIGESTS_PER_RUN,
  digestDecision,
  digestsToSend,
  orderForDigest,
  type DigestCandidate,
  type DigestStudent,
} from "@/lib/counselor/digest";
import { counselorDigestEmail } from "@/lib/email/messages";

const NOW = new Date("2026-09-10T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function student(over: Partial<DigestStudent> = {}): DigestStudent {
  return {
    linkId: "link-1",
    name: "Ada",
    topSeverity: 3,
    signalCount: 1,
    newestSignalAt: daysAgo(1),
    ...over,
  };
}

function candidate(over: Partial<DigestCandidate> = {}): DigestCandidate {
  return {
    counselorAccountId: "acct-1",
    email: "counselor@example.test",
    orgName: "Riverside Counseling",
    students: [student()],
    optedOutAt: null,
    lastDigestAt: null,
    ...over,
  };
}

describe("who gets a digest", () => {
  it("sends to a counselor with something new to report", () => {
    const decision = digestDecision(candidate(), NOW);
    expect(decision.send).toBe(true);
  });

  it("never sends to somebody who opted out", () => {
    // Nothing below this line may overrule it.
    const decision = digestDecision(
      candidate({ optedOutAt: daysAgo(90), lastDigestAt: null }),
      NOW,
    );
    expect(decision).toEqual({ send: false, reason: "opted-out" });
  });

  it("says nothing rather than sending an empty digest", () => {
    // A mail saying "nobody needs you" teaches the reader these are safe to
    // ignore. Silence carries the same information at no cost.
    const decision = digestDecision(candidate({ students: [] }), NOW);
    expect(decision).toEqual({ send: false, reason: "nothing-to-say" });
  });

  it("does not restate a caseload the counselor was already told about", () => {
    // The rule that keeps this from becoming a weekly nag about work already
    // seen. Every signal predates the last digest, so there is no news.
    const decision = digestDecision(
      candidate({
        students: [student({ newestSignalAt: daysAgo(30) })],
        lastDigestAt: daysAgo(20),
      }),
      NOW,
    );
    expect(decision).toEqual({ send: false, reason: "nothing-new" });
  });

  it("sends again once something new appears, even for the same student", () => {
    const decision = digestDecision(
      candidate({
        students: [student({ newestSignalAt: daysAgo(2) })],
        lastDigestAt: daysAgo(10),
      }),
      NOW,
    );
    expect(decision.send).toBe(true);
    if (decision.send) expect(decision.newSince).toBe(1);
  });

  it("holds off when news arrives inside the cooling-off window", () => {
    const decision = digestDecision(
      candidate({
        students: [student({ newestSignalAt: daysAgo(1) })],
        lastDigestAt: daysAgo(2),
      }),
      NOW,
    );
    expect(decision).toEqual({ send: false, reason: "sent-recently" });
  });

  it("reports a quiet week as quiet, not as a cooldown", () => {
    // Both vetoes apply here. The reported reason should be the informative
    // one — nothing happened — rather than the incidental one.
    const decision = digestDecision(
      candidate({
        students: [student({ newestSignalAt: daysAgo(30) })],
        lastDigestAt: daysAgo(1),
      }),
      NOW,
    );
    expect(decision).toEqual({ send: false, reason: "nothing-new" });
  });

  it("counts only the students who are actually new", () => {
    const decision = digestDecision(
      candidate({
        students: [
          student({ linkId: "a", newestSignalAt: daysAgo(1) }),
          student({ linkId: "b", newestSignalAt: daysAgo(2) }),
          student({ linkId: "c", newestSignalAt: daysAgo(40) }),
        ],
        lastDigestAt: daysAgo(10),
      }),
      NOW,
    );
    expect(decision.send).toBe(true);
    if (decision.send) {
      expect(decision.newSince).toBe(2);
      // But all three are still REPORTED — the counselor is owed the whole
      // attention list, not only the part that changed this week.
      expect(decision.students).toHaveLength(3);
    }
  });

  it("is bounded by the cooldown rather than by the schedule", () => {
    // Why the pass is safe to run daily. If this ever inverted, a daily cron
    // could mail the same counselor every day.
    expect(DIGEST_COOLDOWN_DAYS).toBeGreaterThan(1);
  });
});

describe("the run as a whole", () => {
  it("orders by severity, then by what moved most recently", () => {
    const ordered = orderForDigest([
      student({ linkId: "low", topSeverity: 2, newestSignalAt: daysAgo(1) }),
      student({ linkId: "old-high", topSeverity: 5, newestSignalAt: daysAgo(9) }),
      student({ linkId: "new-high", topSeverity: 5, newestSignalAt: daysAgo(1) }),
    ]);
    expect(ordered.map((s) => s.linkId)).toEqual(["new-high", "old-high", "low"]);
  });

  it("does not mutate what it was handed", () => {
    const students = [
      student({ linkId: "a", topSeverity: 1 }),
      student({ linkId: "b", topSeverity: 5 }),
    ];
    orderForDigest(students);
    expect(students.map((s) => s.linkId)).toEqual(["a", "b"]);
  });

  it("caps one run, keeping the caseloads where most has moved", () => {
    const many = Array.from({ length: MAX_DIGESTS_PER_RUN + 10 }, (_, i) =>
      candidate({
        counselorAccountId: `acct-${i}`,
        // Later accounts have more news, so a correct cap keeps them.
        students: Array.from({ length: i + 1 }, (_, n) =>
          student({ linkId: `${i}-${n}` }),
        ),
      }),
    );
    const due = digestsToSend(many, NOW);
    expect(due).toHaveLength(MAX_DIGESTS_PER_RUN);
    expect(due[0]!.newSince).toBeGreaterThan(due.at(-1)!.newSince);
  });

  it("drops every candidate the rules veto", () => {
    const due = digestsToSend(
      [
        candidate({ counselorAccountId: "out", optedOutAt: daysAgo(1) }),
        candidate({ counselorAccountId: "empty", students: [] }),
        candidate({ counselorAccountId: "good" }),
      ],
      NOW,
    );
    expect(due.map((d) => d.candidate.counselorAccountId)).toEqual(["good"]);
  });
});

describe("what the mail may say about a student", () => {
  const mail = counselorDigestEmail({
    to: "counselor@example.test",
    orgName: "Riverside Counseling",
    students: [
      { linkId: "cl_link_9f3a2b", name: "Ada Lovelace" },
      { linkId: "cl_link_7d1c4e", name: null },
    ],
    newSince: 1,
    totalNeedingAttention: 2,
    appUrl: "https://coursechart.app",
    unsubscribeToken: "tok-123",
  });
  const body = `${mail.text} ${mail.html}`;

  it("names them, and says nothing else about them", () => {
    // The disclosure risk. A counselor's inbox is not a place this app can
    // promise anything about, and the student agreed to a counselor reading
    // their file in an app — not to a score sitting in an inbox, on a lock
    // screen, or in a forwarded thread.
    expect(body).toContain("Ada Lovelace");
    expect(body).not.toMatch(/severity|score|percentile|band|GPA|\bgrade\b/i);
    // Nor the machine-readable identifiers, which are just as disclosing when
    // the mail is forwarded and rather more useful to somebody probing.
    expect(body).not.toContain("cl_link_9f3a2b");
    expect(body).not.toContain("cl_link_7d1c4e");
  });

  it("keeps the subject free of names and numbers", () => {
    // The one part shown on a lock screen and in a notification.
    expect(mail.subject).toBe("Your caseload this week");
  });

  it("has something to call a student with no name set", () => {
    expect(body).toContain("A student");
  });

  it("carries a working unsubscribe, in the body and in the header", () => {
    // A bulk message with no unsubscribe control is a spam complaint waiting
    // to happen, and the header is what puts one in the client's own chrome.
    expect(mail.text).toContain("https://coursechart.app/unsubscribe?token=tok-123");
    expect(mail.unsubscribeUrl).toBe(
      "https://coursechart.app/api/unsubscribe?token=tok-123",
    );
  });

  it("sends the counselor to the caseload rather than to a student", () => {
    expect(body).toContain("https://coursechart.app/caseload");
  });

  it("escapes a name that would otherwise inject markup", () => {
    const injected = counselorDigestEmail({
      to: "c@example.test",
      orgName: null,
      students: [{ linkId: "x", name: '<script>alert(1)</script>' }],
      newSince: 1,
      totalNeedingAttention: 1,
      appUrl: "https://coursechart.app",
      unsubscribeToken: "t",
    });
    expect(injected.html).not.toContain("<script>");
    expect(injected.html).toContain("&lt;script&gt;");
  });

  it("counts the students it could not list", () => {
    const big = counselorDigestEmail({
      to: "c@example.test",
      orgName: null,
      students: Array.from({ length: DIGEST_STUDENT_LIMIT }, (_, i) => ({
        linkId: `l${i}`,
        name: `Student ${i}`,
      })),
      newSince: 2,
      totalNeedingAttention: DIGEST_STUDENT_LIMIT + 5,
      appUrl: "https://coursechart.app",
      unsubscribeToken: "t",
    });
    expect(big.text).toContain("and 5 more");
  });

  it("does not claim news it does not have", () => {
    // When everything is new, saying "3 of them are new" alongside "3 students
    // need a look" is noise. The line is omitted rather than made redundant.
    const allNew = counselorDigestEmail({
      to: "c@example.test",
      orgName: null,
      students: [{ linkId: "a", name: "A" }],
      newSince: 1,
      totalNeedingAttention: 1,
      appUrl: "https://coursechart.app",
      unsubscribeToken: "t",
    });
    expect(allNew.text).not.toContain("new since");
  });

  it("keeps the house style: no invented urgency", () => {
    expect(body).not.toMatch(/!|urgent|immediately|act now|don't miss/i);
  });
});
