// The per-account spending cap.
//
// The rate limits bound how FAST credits burn. This bounds the total, and it
// is the only thing standing between an allowlisted account and an unbounded
// bill on someone else's card. Its edges matter more than its middle.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEND_LIMIT_USD,
  evaluateSpend,
  spendLimitMessage,
} from "@/lib/spending";

describe("applying the cap", () => {
  it("allows a run below the budget", () => {
    const s = evaluateSpend(0.5, 2);
    expect(s.allowed).toBe(true);
    expect(s.remainingUsd).toBeCloseTo(1.5, 6);
  });

  it("refuses once the budget is exactly consumed", () => {
    // ">=" not ">": a budget spent to the penny must not buy one more run.
    expect(evaluateSpend(2, 2).allowed).toBe(false);
  });

  it("refuses when already over", () => {
    // Overshoot is expected — a run's cost is not knowable before it finishes —
    // so being over must be a stable refusal, not an error state.
    const s = evaluateSpend(2.4, 2);
    expect(s.allowed).toBe(false);
    expect(s.remainingUsd).toBe(0);
  });

  it("never reports negative remaining budget", () => {
    for (const spent of [2.01, 5, 100]) {
      expect(evaluateSpend(spent, 2).remainingUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("treats a zero or negative limit as no cap at all", () => {
    for (const limit of [0, -1]) {
      const s = evaluateSpend(999, limit);
      expect(s.allowed).toBe(true);
      expect(s.unlimited).toBe(true);
    }
  });

  it("treats nonsense spend as zero rather than as unlimited", () => {
    // A NaN arriving from a failed sum must not read as "spent nothing, carry
    // on" OR as "spent everything" — zero is the only safe reading, and the
    // cap still applies on top of it.
    const s = evaluateSpend(Number.NaN, 2);
    expect(s.spentUsd).toBe(0);
    expect(s.allowed).toBe(true);
  });

  it("defaults to a real budget, not to unlimited", () => {
    expect(DEFAULT_SPEND_LIMIT_USD).toBeGreaterThan(0);
  });
});

describe("what the student is told", () => {
  it("names both numbers and does not blame them", () => {
    const message = spendLimitMessage(evaluateSpend(2.4, 2));
    expect(message).toContain("$2.40");
    expect(message).toContain("$2.00");
    // Their work is not gone, and the limit is not their fault.
    expect(message).toMatch(/still here/i);
    expect(message).not.toMatch(/you have used too much|exceeded your/i);
  });
});
