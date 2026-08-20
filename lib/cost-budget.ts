// A per-run cost ceiling, built into the request rather than policed after it.
//
// The distinction matters and is the whole design. A budget enforced by
// watching a run and stopping it is a tripwire: the tokens are already spent
// when it fires, the student loses the answer, and the app has paid for
// nothing. A budget built into the REQUEST cannot be exceeded in the first
// place, because the request is sized to fit it.
//
// The arithmetic that makes this possible:
//
//   cost = input_tokens x input_price + output_tokens x output_price
//
// Output is bounded EXACTLY by max_tokens — the API stops there and bills no
// more. Input is bounded by what we choose to send, which we can measure before
// sending. So: measure the prompt, work out what it will cost, and spend the
// remainder of the budget on an output allowance. The model then writes freely
// up to an allowance that was already affordable. Nothing aborts, nothing is
// discarded, and the ceiling holds by construction.
//
// WHAT THIS DOES NOT COVER. A retry is a second request and therefore a second
// bill. Callers that retry must subtract the first attempt's ACTUAL usage from
// the budget and size the retry from what is left — see remainingBudget below.
// Getting that wrong is how a "60 cent cap" quietly becomes 120 cents.
import { estimateCost, type TokenUsage } from "./cost";

/**
 * What one run of each tier may cost, in USD.
 *
 * These are ceilings, not forecasts. A Deep Review measured at roughly $0.19 in
 * practice, so 60 cents is about three times the expected cost — deliberately,
 * because the ceiling exists for the run that goes wrong rather than the one
 * that goes normally, and a ceiling set at the average would clip good reviews.
 */
export const RUN_BUDGET_USD = {
  DEEP_REVIEW: envBudget("DEEP_REVIEW_BUDGET_USD", 0.6),
  CHECK_IN: envBudget("CHECK_IN_BUDGET_USD", 0.05),
} as const;

function envBudget(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Characters per token, for sizing a prompt before it is sent.
 *
 * THREE, not the usual four. Everywhere else in this codebase the ratio is an
 * estimate used to check headroom, and four is the honest average for English
 * prose. Here it is one side of a guarantee: under-counting the input means
 * over-spending the output allowance, so this deliberately over-counts. The
 * cost is a slightly smaller allowance than strictly necessary, which is the
 * right direction to be wrong in.
 */
const CHARS_PER_TOKEN = 3;

/** Conservative upper bound on the tokens a prompt will bill as. */
export function estimateInputTokens(...parts: string[]): number {
  const chars = parts.reduce((sum, part) => sum + part.length, 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * The output allowance that fits in what remains of a budget.
 *
 * Input is priced as a CACHE WRITE (2x base) whether or not one happens. A
 * cache write is the most expensive way an input token can bill, and assuming
 * it keeps the ceiling true on the runs that do write one — see lib/cost.ts,
 * where the same worst-case reasoning governs the spend cap.
 *
 * Returns zero when the input alone has consumed the budget. Callers decide
 * what that means; this function does not throw, because a cost calculation is
 * not the right place to make a product decision about a student's run.
 */
export function maxOutputTokensFor(input: {
  budgetUsd: number;
  inputTokens: number;
  model: string;
}): number {
  const inputCost = estimateCost(
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: input.inputTokens,
      cacheReadTokens: 0,
    },
    input.model,
  ) ?? 0;

  const remaining = input.budgetUsd - inputCost;
  if (remaining <= 0) return 0;

  // What one output token costs, derived from the same table rather than
  // restated — a price that drifts between the two would break the ceiling
  // silently.
  const perOutputToken = costOfOutputTokens(1, input.model);
  if (perOutputToken <= 0) return 0;

  return Math.floor(remaining / perOutputToken);
}

/** USD for n output tokens on this model. */
function costOfOutputTokens(n: number, model: string): number {
  return (
    estimateCost(
      { inputTokens: 0, outputTokens: n, cacheWriteTokens: 0, cacheReadTokens: 0 },
      model,
    ) ?? 0
  );
}

/**
 * What is left of a budget after a run that already happened.
 *
 * For sizing a RETRY. The first attempt's usage is exact — it comes back on the
 * response — so this is a real figure rather than an estimate, and a retry
 * sized from it cannot push the pair over the ceiling.
 */
export function remainingBudget(
  budgetUsd: number,
  spent: TokenUsage,
  model: string,
): number {
  return Math.max(0, budgetUsd - (estimateCost(spent, model) ?? 0));
}

/**
 * The smallest output allowance worth asking for.
 *
 * Below this a structured evaluation cannot complete — it would hit the
 * allowance mid-object and come back unparseable, which spends the whole
 * allowance to produce nothing. Callers treat an allowance under this floor as
 * "the context has outgrown the budget", which is a problem to fix by sending
 * less, not by spending more.
 *
 * THIS FLOOR IS PART OF THE CEILING, not a quality nicety, and the tests found
 * that out rather than assuming it. A request pays for its input even when no
 * output allowance is left, so an input large enough to consume the budget by
 * itself breaches the cap merely by being sent — maxOutputTokensFor returns 0
 * and the arithmetic above has nothing left to protect. The guarantee is
 * therefore not "every request costs at most the cap" but:
 *
 *   a request is only ISSUED when its allowance clears this floor, and every
 *   request issued costs at most the cap.
 *
 * Both routes check it before calling the model. Removing either check does not
 * merely degrade output quality; it removes the ceiling.
 */
export const MIN_USEFUL_OUTPUT_TOKENS = {
  DEEP_REVIEW: 4000,
  CHECK_IN: 600,
} as const;
