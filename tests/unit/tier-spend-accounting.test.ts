// No route may return after spending without recording what it spent.
//
// A source-level check, deliberately, because the property is about a route's
// SHAPE rather than its behaviour on any one input. The behavioural test
// (tests/integration/tier-failures.test.ts) proves the recorder works; nothing
// there would notice a future edit that adds a THIRD rejection path and
// returns early from it, which is exactly how this hole appeared the first
// time — the reject-and-return was added, and recording it was not.
//
// The rule: in the tier routes, every 502 that occurs after the model call
// must be preceded by a recordTierFailure. A silent one costs real money on
// the expensive model and leaves no trace in spend, history, or the bill.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// One route now, not two — the deep-review tier is retired. The rule still has
// teeth for the one that remains, and the list is kept as a list so a future
// tier is added here rather than escaping the check.
const ROUTES = ["app/api/evaluations/check-in/route.ts"];

describe("tier routes never spend without recording", () => {
  for (const path of ROUTES) {
    const source = readFileSync(path, "utf8");

    it(`${path} records before every 502`, () => {
      // Everything after the model call is post-spend.
      const callIndex = source.indexOf("client.messages.create");
      expect(callIndex).toBeGreaterThan(-1);
      const postSpend = source.slice(callIndex);

      const returns = postSpend.split("status: 502");
      // The first chunk precedes the first 502; each later chunk follows one.
      const rejections = returns.length - 1;
      expect(rejections).toBeGreaterThan(0);

      for (let i = 0; i < rejections; i += 1) {
        expect(
          returns[i]!.includes("recordTierFailure"),
          `A 502 in ${path} is not preceded by recordTierFailure. Every ` +
            `rejection after the model call has already cost money; returning ` +
            `without recording it hides that spend from the account total, ` +
            `from the student's history, and from anyone reading the bill.`,
        ).toBe(true);
      }
    });

    it(`${path} states its effort explicitly`, () => {
      // Sending output_config with only a format leaves the API's default
      // effort in charge, which silently disconnects ANTHROPIC_EFFORT from the
      // run. That is not a quality question but a billing one: thinking tokens
      // bill as output, and output is about two thirds of a Deep Review's cost,
      // so an unstated effort is an unstated bill. /api/evaluate has always
      // passed it; these routes did not, and nothing noticed for a whole tier
      // build because no test asserts on a request body.
      const config = /output_config:\s*\{[^}]*\}/.exec(source)?.[0];
      expect(config, `${path} has no output_config`).toBeTruthy();
      expect(
        config!.includes("effort"),
        `${path} sends output_config without an effort. Set it from ` +
          `getEffort()/getFollowupEffort() so the configured value governs ` +
          `the run rather than the API default.`,
      ).toBe(true);
    });

    it(`${path} reads usage before it can reject`, () => {
      // The usage object has to be built before the first rejection, or the
      // recorder has nothing to record.
      const usageIndex = source.indexOf("cache_creation_input_tokens");
      const firstReject = source.indexOf("status: 502", source.indexOf("client.messages.create"));
      expect(usageIndex).toBeGreaterThan(-1);
      expect(firstReject).toBeGreaterThan(-1);
      expect(usageIndex).toBeLessThan(firstReject);
    });
  }
});

// A check-in gets a second chance, on the same money.
//
// The Deep Review has retried a malformed response since it was written;
// the check-in never did, and the only check-in that has ever failed in
// production failed exactly that way — an unreadable shape, no second
// attempt, and a student charged for it. Source-level for the same reason as
// everything above: the claim is about the route's shape, and a behavioural
// test would need the model to misbehave on demand.
describe("a check-in retries once before giving up", () => {
  const source = readFileSync("app/api/evaluations/check-in/route.ts", "utf8");

  it("asks again, told what was wrong", () => {
    expect(source).toMatch(/renderRetryNote\(/);
  });

  it("sizes the retry from what the ceiling has left", () => {
    // A retry is a SECOND BILL. Sized from the first attempt's ACTUAL usage —
    // exact, not estimated — so the pair still cannot exceed the per-check-in
    // budget. Without this the "cheap tier" quietly costs twice its cap.
    expect(source).toMatch(/remainingBudget\(\s*RUN_BUDGET_USD\.CHECK_IN/);
    expect(source).toMatch(/MIN_USEFUL_OUTPUT_TOKENS\.CHECK_IN/);
  });

  it("counts both attempts' spend, rather than only the last", () => {
    // Assignment here would report a retry's bill as if it were the whole run
    // and hide the first attempt entirely.
    expect(source).toMatch(/usage\.inputTokens\s*\+=/);
    expect(source).toMatch(/usage\.outputTokens\s*\+=/);
  });

  it("still refuses to store banned phrasing after a retry", () => {
    // Retrying a phrasing violation is a second chance for the MODEL, not a
    // softening of the rule. If the retry offends too, nothing is stored.
    const afterRetry = source.slice(source.indexOf("renderRetryNote("));
    expect(afterRetry).toMatch(/banned\.length > 0/);
    expect(afterRetry).toMatch(/recordTierFailure/);
  });
});
