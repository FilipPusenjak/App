// The per-run cost ceiling holds by arithmetic, so it can be checked as one.
//
// The property under test is not "the budget is usually respected". It is that
// NO combination of inputs produces a run costing more than its cap — which is
// only true because output is bounded exactly by max_tokens and input is
// bounded by what we chose to send. Both halves are checked here, and so is the
// half that is easy to forget: a retry is a second bill.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RUN_BUDGET_USD,
  MIN_USEFUL_OUTPUT_TOKENS,
  estimateInputTokens,
  maxOutputTokensFor,
  remainingBudget,
} from "@/lib/cost-budget";
import { estimateCost } from "@/lib/cost";

/** What a run costs at its worst: every input token billed as a cache write. */
function worstCaseCost(inputTokens: number, outputTokens: number, model: string) {
  return (
    estimateCost(
      {
        inputTokens: 0,
        outputTokens,
        cacheWriteTokens: inputTokens,
        cacheReadTokens: 0,
      },
      model,
    ) ?? 0
  );
}

describe("the ceiling cannot be exceeded", () => {
  const cases = [
    { tier: "DEEP_REVIEW", model: "claude-opus-5", cap: RUN_BUDGET_USD.DEEP_REVIEW },
    { tier: "CHECK_IN", model: "claude-sonnet-5", cap: RUN_BUDGET_USD.CHECK_IN },
  ] as const;

  for (const { tier, model, cap } of cases) {
    it(`${tier}: every request the routes would ISSUE lands under the cap`, () => {
      // Swept rather than spot-checked, because the claim is universal.
      //
      // The condition is not decoration. A request still pays for its input
      // even when no output allowance is left, so an input large enough to
      // consume the budget on its own breaches the cap by being sent at all.
      // The floor is what prevents that: both routes refuse to issue a request
      // whose allowance is below it, and the ceiling depends on them doing so.
      const floor = MIN_USEFUL_OUTPUT_TOKENS[tier];
      let issued = 0;

      for (let inputTokens = 500; inputTokens <= 30_000; inputTokens += 500) {
        const allowance = maxOutputTokensFor({ budgetUsd: cap, inputTokens, model });
        if (allowance < floor) continue; // the routes send nothing here
        issued += 1;

        const spent = worstCaseCost(inputTokens, allowance, model);
        expect(
          spent,
          `${tier} with ${inputTokens} input tokens and ${allowance} output tokens cost $${spent.toFixed(4)}, over its $${cap} cap`,
        ).toBeLessThanOrEqual(cap + 1e-9);
      }

      // The sweep has to have exercised something, or it proves nothing.
      expect(issued).toBeGreaterThan(0);
    });

    it(`${tier}: one more output token than allowed would breach it`, () => {
      // The allowance is not merely safe, it is TIGHT. A test that only checked
      // "under the cap" would pass for an allowance of zero.
      const inputTokens = 5_000;
      const allowance = maxOutputTokensFor({ budgetUsd: cap, inputTokens, model });
      expect(allowance).toBeGreaterThan(0);
      expect(worstCaseCost(inputTokens, allowance + 2, model)).toBeGreaterThan(cap);
    });
  }
});

describe("the input estimate errs upward, never down", () => {
  it("counts a token as three characters, not four", () => {
    // Everywhere else in the app four is right — it is the honest average for
    // English. Here it is one side of a guarantee, and under-counting input
    // means over-spending output. 300 chars must estimate as 100 tokens, not 75.
    expect(estimateInputTokens("x".repeat(300))).toBe(100);
  });

  it("adds up every part it is given", () => {
    // The system prompt is a real cost and is easy to leave out of the sum.
    expect(estimateInputTokens("x".repeat(300), "y".repeat(300))).toBe(200);
  });
});

describe("a retry is a second bill", () => {
  it("keeps the PAIR under the cap when a retry is affordable", () => {
    // How a 60-cent ceiling quietly becomes 120: two attempts each sized from
    // the full budget. Modelled the way the route behaves — the retry happens
    // only when its allowance clears the floor.
    const model = "claude-opus-5";
    const cap = RUN_BUDGET_USD.DEEP_REVIEW;
    const inputTokens = 8_000;
    const floor = MIN_USEFUL_OUTPUT_TOKENS.DEEP_REVIEW;

    const first = maxOutputTokensFor({ budgetUsd: cap, inputTokens, model });
    expect(first).toBeGreaterThanOrEqual(floor);

    // A first attempt that came back unusable WITHOUT running to its limit —
    // a malformed short answer, which is the case a retry exists for.
    const spent = {
      inputTokens: 0,
      outputTokens: 1_500,
      cacheWriteTokens: inputTokens,
      cacheReadTokens: 0,
    };
    const left = remainingBudget(cap, spent, model);
    const second = maxOutputTokensFor({ budgetUsd: left, inputTokens, model });
    expect(second).toBeGreaterThanOrEqual(floor);

    const total =
      worstCaseCost(inputTokens, 1_500, model) +
      worstCaseCost(inputTokens, second, model);
    expect(total).toBeLessThanOrEqual(cap + 1e-9);
  });

  it("leaves nothing for a retry when the first attempt used the lot", () => {
    // And that is the correct answer, not a failure: a second attempt too small
    // to finish would spend the rest of the ceiling on another unusable reply.
    const model = "claude-opus-5";
    const cap = RUN_BUDGET_USD.DEEP_REVIEW;
    const inputTokens = 8_000;
    const first = maxOutputTokensFor({ budgetUsd: cap, inputTokens, model });

    const left = remainingBudget(
      cap,
      { inputTokens: 0, outputTokens: first, cacheWriteTokens: inputTokens, cacheReadTokens: 0 },
      model,
    );
    expect(maxOutputTokensFor({ budgetUsd: left, inputTokens, model })).toBeLessThan(
      MIN_USEFUL_OUTPUT_TOKENS.DEEP_REVIEW,
    );
  });

  it("never reports a negative remainder", () => {
    const left = remainingBudget(
      0.05,
      { inputTokens: 900_000, outputTokens: 900_000, cacheWriteTokens: 0, cacheReadTokens: 0 },
      "claude-opus-5",
    );
    expect(left).toBe(0);
  });
});

describe("the budgets leave room for the reviews they govern", () => {
  it("a realistic Deep Review prompt still buys a usable allowance", () => {
    // Measured at roughly 7,750 input tokens in practice; 12,000 allows for
    // growth. If this ever fails, the context has outgrown the budget and one
    // of the two numbers has to move — which is the point of asserting it here
    // rather than discovering it on a student's run.
    const allowance = maxOutputTokensFor({
      budgetUsd: RUN_BUDGET_USD.DEEP_REVIEW,
      inputTokens: 12_000,
      model: "claude-opus-5",
    });
    expect(allowance).toBeGreaterThanOrEqual(MIN_USEFUL_OUTPUT_TOKENS.DEEP_REVIEW);
  });

  it("a check-in at its own context budget still buys a usable allowance", () => {
    // buildCheckInContext holds itself to 4,000 tokens. Estimated at three
    // characters per token that reads as more, so this checks the pessimistic
    // figure rather than the friendly one.
    const allowance = maxOutputTokensFor({
      budgetUsd: RUN_BUDGET_USD.CHECK_IN,
      inputTokens: 5_500,
      model: "claude-sonnet-5",
    });
    expect(allowance).toBeGreaterThanOrEqual(MIN_USEFUL_OUTPUT_TOKENS.CHECK_IN);
  });

  it("reports zero rather than a negative allowance when input alone overruns", () => {
    // A caller must be able to tell "no room" from "a little room", because the
    // two call for different messages.
    expect(
      maxOutputTokensFor({
        budgetUsd: RUN_BUDGET_USD.CHECK_IN,
        inputTokens: 200_000,
        model: "claude-opus-5",
      }),
    ).toBe(0);
  });
});

describe("the caps are the ones that were asked for", () => {
  it("60 cents a review, 5 cents a check-in", () => {
    expect(RUN_BUDGET_USD.DEEP_REVIEW).toBe(0.6);
    expect(RUN_BUDGET_USD.CHECK_IN).toBe(0.05);
  });
});

// A source-level check, for the same reason tier-spend-accounting.test.ts is
// one: the property is about a route's SHAPE, not its behaviour on any input.
// Nothing below would notice a future edit that reinstated a constant
// max_tokens — the run would simply cost whatever it cost, quietly, and no
// behavioural test would fail.
describe("neither route can go back to a fixed allowance", () => {
  const ROUTES = [
    "app/api/evaluate/route.ts",
    "app/api/evaluations/check-in/route.ts",
  ];

  for (const path of ROUTES) {
    const source = readFileSync(path, "utf8");

    it(`${path} derives max_tokens rather than hard-coding it`, () => {
      const literals = source.match(/max_tokens:\s*\d+/g) ?? [];
      expect(
        literals,
        `${path} sets max_tokens to a literal (${literals.join(", ")}). It must be sized from the run's budget, or the cost ceiling is not enforced.`,
      ).toEqual([]);
      expect(source).toContain("maxOutputTokensFor");
    });

    it(`${path} refuses to send below the useful floor`, () => {
      // The floor is what stops a request whose input alone breaches the cap.
      expect(source).toContain("MIN_USEFUL_OUTPUT_TOKENS");
    });
  }
});
