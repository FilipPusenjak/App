// The retry that could not succeed, and the bill that was never recorded.
//
// Two bugs found by reconstructing one failed Deep Review on the deployment:
//
//   1. The attempt helper threw on max_tokens / refusal BEFORE it recorded the
//      response's usage. The API had billed the tokens; the row said zero.
//   2. The retry was sized from what the budget had left, checked only against
//      the fixed floor, and sent — with less room than the first attempt had
//      already needed to write the same review. It ran out at exactly its
//      allowance, and its error then overwrote the first attempt's reason.
//
// The pure rule is unit-tested. The route-level guarantees are source-level:
// they read the route files and assert on ordering and wiring, because a
// future edit that reorders the accumulation below the throws, or drops the
// worthwhileness gate, would fail no runtime test — the API is mocked away.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { retryIsWorthwhile } from "@/lib/cost-budget";

describe("retryIsWorthwhile", () => {
  const floor = 4000;

  it("refuses when the allowance is below the floor", () => {
    const verdict = retryIsWorthwhile({
      retryAllowance: 3999,
      firstAttemptOutputTokens: 100,
      floor,
    });
    expect(verdict.retry).toBe(false);
    if (!verdict.retry) {
      expect(verdict.reason).toMatch(/^Not retried:/);
      expect(verdict.reason).toContain("3,999");
      expect(verdict.reason).toContain("4,000");
    }
  });

  it("refuses when the allowance is below what the first attempt actually wrote", () => {
    // The deployment case, to the token: above the floor, so the old gate let
    // it through; below the first attempt's 10,169, so it could never finish.
    const verdict = retryIsWorthwhile({
      retryAllowance: 5167,
      firstAttemptOutputTokens: 10169,
      floor,
    });
    expect(verdict.retry).toBe(false);
    if (!verdict.retry) {
      expect(verdict.reason).toMatch(/^Not retried:/);
      expect(verdict.reason).toContain("5,167");
      expect(verdict.reason).toContain("10,169");
      expect(verdict.reason).toMatch(/cannot write the same review in less room/);
    }
  });

  it("accepts when the allowance clears both the floor and the first attempt", () => {
    expect(
      retryIsWorthwhile({ retryAllowance: 10169, firstAttemptOutputTokens: 10169, floor }),
    ).toEqual({ retry: true });
    expect(
      retryIsWorthwhile({ retryAllowance: 18594, firstAttemptOutputTokens: 10169, floor }),
    ).toEqual({ retry: true });
  });

  it("still applies the floor when the first attempt wrote almost nothing", () => {
    // A first attempt that was refused, or malformed after a few hundred
    // tokens, says nothing about how much a real review needs. The floor does.
    const verdict = retryIsWorthwhile({
      retryAllowance: 2000,
      firstAttemptOutputTokens: 300,
      floor,
    });
    expect(verdict.retry).toBe(false);
  });
});

function indexOfOrFail(source: string, needle: string, file: string): number {
  const index = source.indexOf(needle);
  expect(index, `${file} no longer contains ${JSON.stringify(needle)}`).toBeGreaterThan(-1);
  return index;
}

describe.each([
  "app/api/evaluate/route.ts",
  "app/api/project/route.ts",
])("%s records usage before it can throw", (file) => {
  const source = readFileSync(file, "utf8");

  it("accumulates output tokens before the max_tokens throw", () => {
    const record = indexOfOrFail(source, "usage.outputTokens +=", file);
    const throwAt = indexOfOrFail(source, 'stop_reason === "max_tokens"', file);
    expect(
      record,
      "the max_tokens throw comes before usage is recorded, so a response that " +
        "ran out of room is billed by the API and recorded on no row",
    ).toBeLessThan(throwAt);
  });

  it("accumulates output tokens before the refusal throw", () => {
    const record = indexOfOrFail(source, "usage.outputTokens +=", file);
    const throwAt = indexOfOrFail(source, 'stop_reason === "refusal"', file);
    expect(record).toBeLessThan(throwAt);
  });

  it("accumulates rather than assigns, so a retry's bill is added to the first", () => {
    expect(source).not.toMatch(/usage\.outputTokens\s*=\s*message/);
    expect(source).not.toMatch(/usage\.inputTokens\s*=\s*message/);
  });
});

describe("app/api/evaluate/route.ts sizes and gates its retry", () => {
  const source = readFileSync("app/api/evaluate/route.ts", "utf8");

  it("gates the retry on retryIsWorthwhile, not on the floor alone", () => {
    expect(source).toContain("retryIsWorthwhile({");
    expect(source).toMatch(/firstAttemptOutputTokens,?\s*\n?\s*floor: MIN_USEFUL_OUTPUT_TOKENS\.DEEP_REVIEW/);
  });

  it("reads the first attempt's output BEFORE the retry adds to usage", () => {
    const read = indexOfOrFail(source, "const firstAttemptOutputTokens = usage.outputTokens", "evaluate");
    const retryCall = indexOfOrFail(source, "await attempt(renderRetryNote(", "evaluate");
    expect(read).toBeLessThan(retryCall);
  });

  it("sizes the retry from the remaining budget, not the original one", () => {
    const sizing = source.slice(
      indexOfOrFail(source, "const retryAllowance = maxOutputTokensFor({", "evaluate"),
    );
    expect(sizing.slice(0, 400)).toContain("remainingBudget(RUN_BUDGET_USD.DEEP_REVIEW, usage,");
  });

  it("keeps the first attempt's reason when the retry throws", () => {
    // The retry's own failure describes a response to a correction. The first
    // failure describes the original problem, and used to be erased by it.
    expect(source).toContain("Retried once; the retry then failed too:");
    expect(source).toContain("Retried once; still unusable.");
  });

  it("still lets a deadline abort propagate out of the retry", () => {
    // The catch that preserves the first reason must not swallow the abort
    // that the outer handler turns into a timeout message.
    const catchAt = indexOfOrFail(source, "the retry then failed too", "evaluate");
    const window = source.slice(Math.max(0, catchAt - 600), catchAt);
    expect(window).toContain("if (isDeadlineAbort(error)) throw error;");
  });

  it("says why when it declines to retry, appended to the first reason", () => {
    expect(source).toContain("`${outcome.reason} ${verdict.reason}`");
  });
});
