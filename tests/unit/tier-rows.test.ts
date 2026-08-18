// The rule that decides which stored rows are Deep Reviews.
//
// This exists because getting it wrong is not a display bug. Evaluation.type
// defaults to "DEEP_REVIEW", so every legacy percentile evaluation carries that
// type; matching on it made the 21-day floor count a legacy run as "your last
// Deep Review" and refuse the student's FIRST one for three weeks. The tests
// below are written against that specific row — a legacy evaluation wearing the
// default type — because that is the row that caused the outage.
import { describe, expect, it } from "vitest";
import {
  DEEP_REVIEW_VERSION_PREFIX,
  isDeepReviewRow,
  tierWhere,
} from "@/lib/evaluation/tier-rows";
import {
  checkDeepReviewAllowed,
  DEEP_REVIEW_INTERVAL_DAYS,
} from "@/lib/evaluation/tier-access";
import { DEEP_REVIEW_PROMPT_VERSION } from "@/lib/prompts/tiers/deep-review-v3";
import { CHECK_IN_PROMPT_VERSION } from "@/lib/prompts/tiers/check-in-v3";

const NOW = new Date("2026-08-18T12:00:00Z");
const HOURS_AGO = new Date(NOW.getTime() - 5 * 3_600_000);

/** A percentile evaluation from before tiers existed, exactly as stored. */
const legacyRow = {
  type: "DEEP_REVIEW",
  promptVersion: "evaluation/v6",
  status: "completed",
  isSample: false,
};

/** A real Deep Review, written by the deep-review route. */
const deepReviewRow = {
  type: "DEEP_REVIEW",
  promptVersion: DEEP_REVIEW_PROMPT_VERSION,
  status: "completed",
  isSample: false,
};

describe("the deep-review prompt versions agree with the predicate", () => {
  it("names the live deep-review prompt with the prefix the rule matches", () => {
    // If the prompt version were ever renamed without the prefix, every real
    // Deep Review would stop counting as one and the 21-day floor would never
    // engage. Pinning it here makes that rename fail loudly.
    expect(DEEP_REVIEW_PROMPT_VERSION.startsWith(DEEP_REVIEW_VERSION_PREFIX)).toBe(
      true,
    );
  });

  it("does not let a check-in wear the deep-review prefix", () => {
    expect(CHECK_IN_PROMPT_VERSION.startsWith(DEEP_REVIEW_VERSION_PREFIX)).toBe(
      false,
    );
  });
});

describe("isDeepReviewRow", () => {
  it("counts a real deep review", () => {
    expect(isDeepReviewRow(deepReviewRow)).toBe(true);
  });

  it("does NOT count a legacy evaluation carrying the default type", () => {
    // The regression. type is "DEEP_REVIEW" here and must not be enough.
    expect(legacyRow.type).toBe("DEEP_REVIEW");
    expect(isDeepReviewRow(legacyRow)).toBe(false);
  });

  it("does not count a row with no promptVersion at all", () => {
    // A no-change check-in stores none. Nothing without a version is a review.
    expect(isDeepReviewRow({ ...legacyRow, promptVersion: null })).toBe(false);
  });

  it("does not count a check-in", () => {
    expect(
      isDeepReviewRow({ ...deepReviewRow, promptVersion: CHECK_IN_PROMPT_VERSION }),
    ).toBe(false);
  });

  it("does not count a failed run", () => {
    // A review that never reached the student cannot start their clock, even
    // though the tokens it burned are still recorded against the account.
    expect(isDeepReviewRow({ ...deepReviewRow, status: "failed" })).toBe(false);
  });

  it("does not count the sample", () => {
    expect(isDeepReviewRow({ ...deepReviewRow, isSample: true })).toBe(false);
  });
});

describe("tierWhere", () => {
  it("guards DEEP_REVIEW with the promptVersion prefix", () => {
    expect(tierWhere("DEEP_REVIEW")).toEqual({
      type: "DEEP_REVIEW",
      promptVersion: { startsWith: DEEP_REVIEW_VERSION_PREFIX },
    });
  });

  it("leaves CHECK_IN unguarded, on purpose", () => {
    // A no-change check-in stores no promptVersion. Adding the guard here would
    // drop exactly the rows the next check-in measures its delta against.
    expect(tierWhere("CHECK_IN")).toEqual({ type: "CHECK_IN" });
    expect(tierWhere("CHECK_IN")).not.toHaveProperty("promptVersion");
  });
});

describe("the 21-day floor, applied to a real history", () => {
  // End to end over the two pieces the page composes: pick the last deep
  // review out of the list, then ask the gate. This is the user-visible bug,
  // stated as a test.
  const gateFor = (rows: typeof legacyRow[]) =>
    checkDeepReviewAllowed({
      tier: "PAID",
      lastDeepReviewAt: rows.find(isDeepReviewRow) ? HOURS_AGO : null,
      now: NOW,
    });

  it("allows the first deep review to an account that only has legacy runs", () => {
    // The reported symptom: "Your last Deep Review was less than 21 days ago"
    // on an account that had never run one.
    expect(gateFor([legacyRow]).allowed).toBe(true);
  });

  it("still holds the floor once a real deep review exists", () => {
    const gate = gateFor([deepReviewRow, legacyRow]);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed && gate.reason === "interval") {
      expect(gate.daysRemaining).toBe(DEEP_REVIEW_INTERVAL_DAYS);
    }
  });
});
