// Which proposals become rows, and which are the same thing said twice.
//
// The rule is deliberately conservative, and these tests pin the conservatism
// as much as the matching. A loose similarity threshold would silently discard
// a genuinely different commitment about the same activity — and a student can
// decline a duplicate in one click, but cannot recover a proposal the app threw
// away without telling them.
import { describe, expect, it } from "vitest";
import {
  commitmentsToWrite,
  normalizeDescription,
  sameCommitment,
} from "@/lib/commitments/text";

describe("what counts as the same commitment", () => {
  it("ignores case, padding and a trailing full stop", () => {
    // The ways one model emits one sentence twice.
    expect(sameCommitment("Enter the olympiad", "enter the olympiad")).toBe(true);
    expect(sameCommitment("Enter the olympiad", "  Enter the olympiad  ")).toBe(true);
    expect(sameCommitment("Enter the olympiad", "Enter the olympiad.")).toBe(true);
    expect(sameCommitment("Enter the  olympiad", "Enter the olympiad")).toBe(true);
  });

  it("does NOT treat two similar commitments as one", () => {
    // The conservatism, stated as a test. These are close, and they are
    // different undertakings — one is a specific person, one is anyone.
    expect(
      sameCommitment(
        "Send the write-up to your physics teacher",
        "Send the write-up to a teacher",
      ),
    ).toBe(false);
    // Same activity, different rung. Dropping the second would remove the
    // escalation the review was actually proposing.
    expect(
      sameCommitment("Join the olympiad club", "Lead the olympiad club"),
    ).toBe(false);
  });

  it("normalizes to something stable and lowercase", () => {
    expect(normalizeDescription("  Enter The Olympiad!! ")).toBe(
      "enter the olympiad",
    );
  });
});

describe("which proposals become rows", () => {
  const proposals = [
    { description: "Enter the olympiad", dueInWeeks: 8 },
    { description: "Send the write-up to a teacher", dueInWeeks: 4 },
  ];

  it("writes everything when nothing is open", () => {
    expect(commitmentsToWrite(proposals, [])).toHaveLength(2);
  });

  it("drops one the student already took on", () => {
    // Re-proposing an accepted commitment asks them to agree to something they
    // agreed to weeks ago, and it then appears twice in every check-in.
    const out = commitmentsToWrite(proposals, [
      { description: "enter the olympiad." },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("Send the write-up to a teacher");
  });

  it("drops a repeat within one review's own output", () => {
    const out = commitmentsToWrite(
      [
        { description: "Enter the olympiad", dueInWeeks: 8 },
        { description: "Enter the olympiad.", dueInWeeks: 12 },
      ],
      [],
    );
    expect(out).toHaveLength(1);
  });

  it("keeps a proposal that merely resembles an open one", () => {
    // The failure mode of a looser rule: the review proposed an escalation and
    // the app silently swallowed it because it shared most of its words.
    const out = commitmentsToWrite(
      [{ description: "Lead the olympiad club", dueInWeeks: 8 }],
      [{ description: "Join the olympiad club" }],
    );
    expect(out).toHaveLength(1);
  });

  it("can legitimately return nothing", () => {
    // Every proposal was already accepted. Writing zero rows is the correct
    // outcome — the narrative still records what the review suggested.
    const out = commitmentsToWrite(proposals, [
      { description: "Enter the olympiad" },
      { description: "Send the write-up to a teacher" },
    ]);
    expect(out).toEqual([]);
  });

  it("preserves order and the rest of each proposal", () => {
    const out = commitmentsToWrite(
      [{ description: "A", dueInWeeks: 4, targetRung: "contributor" }],
      [],
    );
    expect(out[0]).toEqual({
      description: "A",
      dueInWeeks: 4,
      targetRung: "contributor",
    });
  });
});
