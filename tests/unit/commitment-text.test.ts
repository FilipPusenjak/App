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
  sanitizeProposals,
  MAX_PROPOSED_COMMITMENTS,
} from "@/lib/commitments/text";

const proposal = (over: Partial<{ description: string; targetRung: string | null; dueInWeeks: number }> = {}) => ({
  description: "Send the write-up to a teacher",
  targetRung: null,
  dueInWeeks: 4,
  ...over,
});

// Clamping rather than rejecting, and the difference is a Deep Review's worth
// of tokens. Structured outputs constrain shape, not counts or ranges — so a
// `.min(2)` in the schema never stopped the model returning one, it only made
// Zod discard the whole billed response afterwards. These are the same rules,
// applied where applying them is free.
describe("bringing a review's proposals inside bounds", () => {
  it("trims to four rather than refusing five", () => {
    const out = sanitizeProposals(
      Array.from({ length: 5 }, (_, n) => proposal({ description: `A${n}` })),
    );
    expect(out).toHaveLength(MAX_PROPOSED_COMMITMENTS);
    // The first four, not an arbitrary sample — the model ranks them.
    expect(out.map((p) => p.description)).toEqual(["A0", "A1", "A2", "A3"]);
  });

  it("keeps a single proposal rather than demanding two", () => {
    expect(sanitizeProposals([proposal()])).toHaveLength(1);
  });

  it("clamps a due window instead of throwing the review away", () => {
    expect(sanitizeProposals([proposal({ dueInWeeks: 0 })])[0]!.dueInWeeks).toBe(1);
    expect(sanitizeProposals([proposal({ dueInWeeks: -4 })])[0]!.dueInWeeks).toBe(1);
    expect(sanitizeProposals([proposal({ dueInWeeks: 500 })])[0]!.dueInWeeks).toBe(104);
  });

  it("rounds a fractional week — nobody asked for a Thursday afternoon", () => {
    expect(sanitizeProposals([proposal({ dueInWeeks: 4.4 })])[0]!.dueInWeeks).toBe(4);
    expect(sanitizeProposals([proposal({ dueInWeeks: 4.6 })])[0]!.dueInWeeks).toBe(5);
  });

  it("drops a proposal with no text, because there is no honest repair", () => {
    // Everything else here is a value fixed around an assessment that is fine.
    // A commitment that does not say what to do cannot be fixed, and offering
    // a student an empty row to accept is worse than offering nothing.
    const out = sanitizeProposals([proposal({ description: "   " }), proposal()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("Send the write-up to a teacher");
  });

  it("does NOT truncate a long description", () => {
    // Cutting mid-sentence can invert a commitment: "do X, but only after Y"
    // truncated at the comma says the opposite of what was written. The column
    // is unbounded text and the card wraps, so there is nothing to gain.
    const long = "x".repeat(900);
    expect(sanitizeProposals([proposal({ description: long })])[0]!.description)
      .toHaveLength(900);
  });

  it("leaves a well-formed set completely alone", () => {
    const input = [proposal({ description: "A" }), proposal({ description: "B" })];
    expect(sanitizeProposals(input)).toEqual(input);
  });
});

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
