// What a run actually cost, and what caching did to it.
//
// This exists because "it feels like it's costing more each time" is not
// something anyone can act on. The API reports exactly what it billed; storing
// and showing it turns a guess into a number.
//
// The prices below are for reporting only — nothing bills from them, and a
// stale figure changes a displayed estimate rather than anything real.

/** Per million tokens, in USD. Base input, then the cache multipliers. */
type Price = { input: number; output: number };

/**
 * Standard list prices, deliberately NOT promotional ones.
 *
 * Sonnet 5 carries an introductory rate ($2/$10 rather than $3/$15) through
 * 2026-08-31, so a Sonnet run inside that window is reported as costing up to
 * 50% more than it actually bills. That direction is the correct one to be
 * wrong in: this table feeds the per-account spend cap as well as the display,
 * and a cap computed from a discount that expires would let an account overrun
 * its real limit the day the discount ends. An over-estimate stops slightly
 * early; an under-estimate does not stop at all.
 *
 * The consequence worth knowing: the figure shown next to a Sonnet run is a
 * ceiling, not a bill. The Anthropic Console is the ground truth.
 */
const PRICES: Record<string, Price> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache reads are cheap; WRITES are a premium over base input. */
const CACHE_READ_MULTIPLIER = 0.1;
/**
 * A 1-hour cache write costs 2x base input, a 5-minute write 1.25x. The higher
 * one is assumed so an estimate errs toward over-reporting rather than
 * flattering the change that introduced it.
 */
const CACHE_WRITE_MULTIPLIER = 2;

export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
};

/** Estimated USD for one run. Null when nothing was recorded. */
export function estimateCost(
  usage: TokenUsage,
  model: string | null | undefined,
): number | null {
  const price = PRICES[model ?? ""] ?? PRICES["claude-opus-5"]!;
  const { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens } = usage;

  if (
    inputTokens == null &&
    outputTokens == null &&
    cacheWriteTokens == null &&
    cacheReadTokens == null
  ) {
    return null;
  }

  const perToken = price.input / 1_000_000;
  return (
    (inputTokens ?? 0) * perToken +
    (cacheWriteTokens ?? 0) * perToken * CACHE_WRITE_MULTIPLIER +
    (cacheReadTokens ?? 0) * perToken * CACHE_READ_MULTIPLIER +
    (outputTokens ?? 0) * (price.output / 1_000_000)
  );
}

/**
 * What caching did to THIS run, in plain terms.
 *
 * A run that only wrote the cache paid a premium and got nothing back for it,
 * which is the failure mode worth surfacing: it is indistinguishable from a
 * saving unless someone is looking at the two numbers separately.
 */
export function cacheVerdict(usage: TokenUsage): {
  state: "hit" | "write-only" | "none";
  savedUsd: number | null;
} {
  const read = usage.cacheReadTokens ?? 0;
  const write = usage.cacheWriteTokens ?? 0;
  const perToken = 5 / 1_000_000;

  if (read > 0) {
    // Paid 0.1x on these instead of 1x.
    return { state: "hit", savedUsd: read * perToken * (1 - CACHE_READ_MULTIPLIER) };
  }
  if (write > 0) {
    // Paid 2x on these and read none of it back — a loss, reported as one.
    return {
      state: "write-only",
      savedUsd: -(write * perToken * (CACHE_WRITE_MULTIPLIER - 1)),
    };
  }
  return { state: "none", savedUsd: null };
}

/** "$0.34" / "<$0.01" — small numbers should not render as "$0.00". */
export function formatUsd(amount: number | null): string | null {
  if (amount == null) return null;
  const abs = Math.abs(amount);
  if (abs < 0.005) return abs === 0 ? "$0.00" : "<$0.01";
  return `${amount < 0 ? "-" : ""}$${abs.toFixed(2)}`;
}
