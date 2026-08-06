// The disclosure rules for Activity Discovery.
//
// These are the tests that matter most in the app. Everything else here fails
// visibly — a wrong score is argued with, a broken page is reported. A leak in
// an aggregate is silent, lands on a minor, and cannot be taken back once a
// classmate has read it.
//
// So these assert the floor over the whole input space rather than at a few
// hand-picked values, and they assert the ABSENCE of signal as hard as the
// presence of data: a suppressed row must be indistinguishable from a row that
// was never there.
import { describe, expect, it } from "vitest";
import {
  MIN_ACTIVITY_COUNT,
  MIN_COHORT_SIZE,
  IDENTIFYING_MULTIPLIER,
  bucketActivityCount,
  bucketCohortSize,
  bucketRungDistribution,
  isReportableCohort,
} from "@/lib/discovery/policy";

describe("cohort floor", () => {
  it("reports nothing at all below the minimum cohort size", () => {
    for (let n = 0; n < MIN_COHORT_SIZE; n++) {
      expect(isReportableCohort(n)).toBe(false);
      expect(bucketCohortSize(n)).toBeNull();
    }
  });

  it("reports a cohort at and above the minimum", () => {
    expect(isReportableCohort(MIN_COHORT_SIZE)).toBe(true);
    expect(bucketCohortSize(MIN_COHORT_SIZE)).toBe("10-19");
    expect(bucketCohortSize(20)).toBe("20+");
    expect(bucketCohortSize(4_000)).toBe("20+");
  });

  it("never exposes a cohort bucket narrower than the floor", () => {
    // A "5-9" cohort bucket would be a shape the API can never legitimately
    // return, so its existence would itself be a hint.
    for (let n = 0; n <= 200; n++) {
      const bucket = bucketCohortSize(n);
      if (bucket !== null) expect(["10-19", "20+"]).toContain(bucket);
    }
  });
});

describe("activity floor", () => {
  it("suppresses any activity below the minimum", () => {
    for (let n = 0; n < MIN_ACTIVITY_COUNT; n++) {
      expect(bucketActivityCount(n)).toBeNull();
    }
  });

  it("returns a bucket at and above the minimum", () => {
    expect(bucketActivityCount(MIN_ACTIVITY_COUNT)).toBe("5-9");
    expect(bucketActivityCount(9)).toBe("5-9");
    expect(bucketActivityCount(10)).toBe("10-19");
    expect(bucketActivityCount(19)).toBe("10-19");
    expect(bucketActivityCount(20)).toBe("20+");
  });

  it("requires double for a highly identifying activity", () => {
    const floor = MIN_ACTIVITY_COUNT * IDENTIFYING_MULTIPLIER;
    for (let n = 0; n < floor; n++) {
      expect(bucketActivityCount(n, { isHighlyIdentifying: true })).toBeNull();
    }
    expect(bucketActivityCount(floor, { isHighlyIdentifying: true })).not.toBeNull();
  });

  it("is never more permissive for an identifying activity than an ordinary one", () => {
    // The invariant, over the whole range: flagging something as identifying
    // can only ever withhold more, never less.
    for (let n = 0; n <= 100; n++) {
      const ordinary = bucketActivityCount(n);
      const identifying = bucketActivityCount(n, { isHighlyIdentifying: true });
      if (identifying !== null) expect(ordinary).not.toBeNull();
    }
  });

  it("never returns an exact count in any form", () => {
    // Differencing is the attack these buckets exist to stop, so nothing that
    // leaves this function may be a number or parse as one.
    for (let n = 0; n <= 500; n++) {
      const bucket = bucketActivityCount(n);
      if (bucket === null) continue;
      expect(["5-9", "10-19", "20+"]).toContain(bucket);
      expect(Number.isNaN(Number(bucket))).toBe(true);
    }
  });

  it("refuses nonsense input rather than treating it as large", () => {
    // A NaN arriving from a failed aggregate must not read as "above the floor".
    expect(bucketActivityCount(Number.NaN)).toBeNull();
    expect(bucketActivityCount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(bucketCohortSize(Number.NaN)).toBeNull();
    expect(isReportableCohort(Number.NaN)).toBe(false);
  });
});

describe("suppression is silent", () => {
  it("drops a rare rung from the distribution rather than reporting it as zero", () => {
    // An activity can clear the floor overall while one rung within it is a
    // single student. Reporting that rung as 0 or as "hidden" identifies them
    // just as well as reporting the 1.
    const bucketed = bucketRungDistribution({
      PARTICIPANT: 12,
      OFFICER: 6,
      NATIONAL: 1,
    });
    expect(bucketed).toEqual({ PARTICIPANT: "10-19", OFFICER: "5-9" });
    expect(Object.keys(bucketed)).not.toContain("NATIONAL");
  });

  it("returns an empty object, not a marker, when every rung is too small", () => {
    const bucketed = bucketRungDistribution({ PARTICIPANT: 2, OFFICER: 1 });
    expect(bucketed).toEqual({});
    expect(JSON.stringify(bucketed)).not.toMatch(/hidden|suppress|null|0/i);
  });

  it("carries the doubled floor into the rung breakdown", () => {
    // Otherwise the rung distribution becomes the way around rule 6: the
    // activity is withheld, but its rungs are published.
    const bucketed = bucketRungDistribution(
      { NATIONAL: MIN_ACTIVITY_COUNT },
      { isHighlyIdentifying: true },
    );
    expect(bucketed).toEqual({});
  });

  it("emits nothing that distinguishes suppressed from absent", () => {
    // The whole response for a suppressed activity and for one nobody does
    // must serialize identically.
    const suppressed = bucketRungDistribution({ OFFICER: 1 });
    const absent = bucketRungDistribution({});
    expect(JSON.stringify(suppressed)).toBe(JSON.stringify(absent));
  });
});

describe("thresholds cannot be weakened by configuration", () => {
  it("keeps the built-in floor as a hard minimum", () => {
    // Read at module load, so this asserts the shipped values rather than
    // re-reading env. The guard itself is that a lower env value is ignored:
    // an ops typo must never be why a child is identifiable.
    expect(MIN_COHORT_SIZE).toBeGreaterThanOrEqual(10);
    expect(MIN_ACTIVITY_COUNT).toBeGreaterThanOrEqual(5);
    expect(IDENTIFYING_MULTIPLIER).toBeGreaterThanOrEqual(2);
  });
});
