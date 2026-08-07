// Aborting before the platform does.
//
// A serverless function killed mid-stream bills the tokens, loses the answer,
// leaves the row "pending", and surfaces five minutes later as a vague note
// about the server no longer waiting. The run fails either way — but aborting
// ourselves means the app KNOWS why, can say so at once, and can say what to
// change. These pin the arithmetic that decides when to give up.
import { describe, expect, it } from "vitest";

// Mirrors the route's constants, which are not exported (the route module
// pulls in Prisma and the SDK, so importing it here would be a heavier
// dependency than the arithmetic being checked).
const MODEL_DEADLINE_FRACTION = 0.85;

function remaining(budgetMs: number, elapsedMs: number): number {
  if (!Number.isFinite(budgetMs)) return Number.POSITIVE_INFINITY;
  return budgetMs * MODEL_DEADLINE_FRACTION - elapsedMs;
}

describe("the model deadline", () => {
  it("leaves room to record the result", () => {
    // The whole point: finishing the model call at the limit is no better than
    // being killed, because there is no time left to write the answer down.
    const budget = 60_000;
    expect(remaining(budget, 0)).toBeLessThan(budget);
    expect(budget - remaining(budget, 0)).toBeGreaterThanOrEqual(9_000);
  });

  it("shrinks as the request goes on", () => {
    expect(remaining(60_000, 20_000)).toBeLessThan(remaining(60_000, 0));
  });

  it("goes negative once the budget is spent, so a retry is not attempted", () => {
    expect(remaining(60_000, 59_000)).toBeLessThan(0);
  });

  it("is unlimited in development, where no platform ceiling exists", () => {
    // A fixed deadline in development was the bug that made the retry path
    // dead code for months; an artificial one here would repeat it.
    expect(remaining(Number.POSITIVE_INFINITY, 500_000)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("never yields a deadline at or below zero once floored by the route", () => {
    // The route floors at 1s so AbortSignal.timeout is always given a valid
    // positive duration, even when the budget is already gone.
    const floored = Math.max(remaining(60_000, 120_000), 1_000);
    expect(floored).toBeGreaterThan(0);
  });
});
