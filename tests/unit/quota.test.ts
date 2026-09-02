// The quota, and the codes that let somebody past it.
//
// The quota is what the product is SOLD as — "one deep review every month,
// weekly plans projections, check in every two days" is on the Stripe product
// itself. So the first thing tested is that the code agrees with the sentence a
// customer paid against.
import { describe, expect, it } from "vitest";
import {
  FREE_QUOTA,
  PLUS_QUOTA,
  RUN_KINDS,
  checkQuota,
  describeInterval,
  quotaFor,
  standingFor,
} from "@/lib/billing/quota";
import { STUDENT_FREE, STUDENT_PLUS, TUTOR_20 } from "@/lib/billing/plans";
import { generateCode, normalizeCode } from "@/lib/billing/codes";

const NOW = new Date("2026-06-15T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("the quota matches what the product says it sells", () => {
  /**
   * The paid tier is advertised as "1 deep review every month, weekly plans
   * projections, check in every two days". If somebody changes one of these
   * numbers without changing the Stripe description, they have made the app
   * quietly stop honouring what a customer bought.
   */
  it("enforces the advertised intervals exactly", () => {
    expect(PLUS_QUOTA).toEqual({
      DEEP_REVIEW: 30,
      PROJECTION: 7,
      CHECK_IN: 2,
    });
  });

  it("describes them in the same words the product uses", () => {
    expect(describeInterval(PLUS_QUOTA.DEEP_REVIEW)).toBe("monthly");
    expect(describeInterval(PLUS_QUOTA.PROJECTION)).toBe("weekly");
    expect(describeInterval(PLUS_QUOTA.CHECK_IN)).toBe("every two days");
  });

  it("gives the free tier strictly less of everything", () => {
    // Otherwise paying for Plus buys nothing, which is worse than not selling it.
    for (const kind of RUN_KINDS) {
      expect({ kind, free: FREE_QUOTA[kind], plus: PLUS_QUOTA[kind] }).toEqual({
        kind,
        free: expect.any(Number),
        plus: expect.any(Number),
      });
      expect(FREE_QUOTA[kind]).toBeGreaterThan(PLUS_QUOTA[kind]);
    }
  });

  it("puts an unsubscribed account on the free quota", () => {
    expect(quotaFor(null)).toEqual(FREE_QUOTA);
    expect(quotaFor(STUDENT_FREE)).toEqual(FREE_QUOTA);
    expect(quotaFor(STUDENT_PLUS)).toEqual(PLUS_QUOTA);
  });

  it("does not let a tutor band buy a student's quota", () => {
    // The two products are sold separately; a caseload plan is not a student
    // plan wearing a different name.
    expect(quotaFor(TUTOR_20)).toEqual(FREE_QUOTA);
  });
});

describe("when a run is allowed", () => {
  it("allows the very first run of anything", () => {
    expect(
      checkQuota({
        kind: "DEEP_REVIEW",
        lastRunAt: null,
        policy: PLUS_QUOTA,
        creditsAvailable: 0,
        now: NOW,
      }),
    ).toEqual({ allowed: true, usingCredit: false });
  });

  it("allows once the interval has passed", () => {
    expect(
      checkQuota({
        kind: "DEEP_REVIEW",
        lastRunAt: daysAgo(31),
        policy: PLUS_QUOTA,
        creditsAvailable: 0,
        now: NOW,
      }),
    ).toEqual({ allowed: true, usingCredit: false });
  });

  it("refuses inside the interval, and names the date", () => {
    const decision = checkQuota({
      kind: "DEEP_REVIEW",
      lastRunAt: daysAgo(10),
      policy: PLUS_QUOTA,
      creditsAvailable: 0,
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      // A date somebody can plan around, not a countdown they have to convert.
      expect(decision.nextAvailableAt.toISOString()).toBe(
        "2026-07-05T12:00:00.000Z",
      );
      expect(decision.message).toContain("July 5");
      expect(decision.message).toMatch(/code/i);
    }
  });

  it("treats the boundary as available rather than one second short", () => {
    const lastRunAt = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(
      checkQuota({
        kind: "CHECK_IN",
        lastRunAt,
        policy: PLUS_QUOTA,
        creditsAvailable: 0,
        now: NOW,
      }).allowed,
    ).toBe(true);
  });

  it("treats a non-positive interval as unlimited", () => {
    expect(
      checkQuota({
        kind: "PROJECTION",
        lastRunAt: NOW,
        policy: { ...PLUS_QUOTA, PROJECTION: 0 },
        creditsAvailable: 0,
        now: NOW,
      }),
    ).toEqual({ allowed: true, usingCredit: false });
  });
});

describe("a code is only spent when it is actually needed", () => {
  /**
   * The rule that stops a tester burning their code on a run they were entitled
   * to anyway — which is exactly what happens if credits are checked first.
   */
  it("does not touch a credit when the interval already allows the run", () => {
    expect(
      checkQuota({
        kind: "DEEP_REVIEW",
        lastRunAt: daysAgo(60),
        policy: PLUS_QUOTA,
        creditsAvailable: 3,
        now: NOW,
      }),
    ).toEqual({ allowed: true, usingCredit: false });
  });

  it("spends one when the interval would refuse", () => {
    expect(
      checkQuota({
        kind: "DEEP_REVIEW",
        lastRunAt: daysAgo(1),
        policy: PLUS_QUOTA,
        creditsAvailable: 1,
        now: NOW,
      }),
    ).toEqual({ allowed: true, usingCredit: true });
  });

  it("refuses again once the credits are gone", () => {
    expect(
      checkQuota({
        kind: "DEEP_REVIEW",
        lastRunAt: daysAgo(1),
        policy: PLUS_QUOTA,
        creditsAvailable: 0,
        now: NOW,
      }).allowed,
    ).toBe(false);
  });

  it("keeps credits for one kind out of another", () => {
    // A projection code must not buy a Deep Review; they cost very different
    // amounts of model time.
    expect(
      checkQuota({
        kind: "DEEP_REVIEW",
        lastRunAt: daysAgo(1),
        policy: PLUS_QUOTA,
        creditsAvailable: 0,
        now: NOW,
      }).allowed,
    ).toBe(false);
  });
});

describe("what the plan page shows", () => {
  it("reports availability and the next date together", () => {
    const standing = standingFor({
      kind: "PROJECTION",
      lastRunAt: daysAgo(2),
      policy: PLUS_QUOTA,
      credits: 0,
      now: NOW,
    });
    expect(standing.availableNow).toBe(false);
    expect(standing.intervalLabel).toBe("weekly");
    expect(standing.nextAvailableAt?.toISOString()).toBe(
      "2026-06-20T12:00:00.000Z",
    );
  });

  it("has no next date when nothing has been run yet", () => {
    const standing = standingFor({
      kind: "DEEP_REVIEW",
      lastRunAt: null,
      policy: FREE_QUOTA,
      credits: 0,
      now: NOW,
    });
    expect(standing.availableNow).toBe(true);
    expect(standing.nextAvailableAt).toBeNull();
  });
});

describe("codes are made to be read down a phone", () => {
  it("uses no character that can be misread as another", () => {
    // 0/O, 1/I/L, 5/S and 8/B are all a support message waiting to happen.
    for (let i = 0; i < 50; i += 1) {
      expect(generateCode()).not.toMatch(/[01ILOSB]/);
    }
  });

  it("is long enough not to be guessed", () => {
    // 8 characters from a 27-character alphabet.
    const body = generateCode().replace(/^CHART-/, "").replace(/-/g, "");
    expect(body.length).toBeGreaterThanOrEqual(8);
  });

  it("forgives how somebody types it back", () => {
    const code = "CHART-QU8W-MFVE";
    for (const typed of [
      "chart-qu8w-mfve",
      "  CHART-QU8W-MFVE  ",
      "CHARTQU8WMFVE",
      "chart qu8w mfve",
    ]) {
      expect(normalizeCode(typed)).toBe(normalizeCode(code));
    }
  });

  it("does not collide across a realistic batch", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCode()));
    expect(codes.size).toBe(500);
  });
});
