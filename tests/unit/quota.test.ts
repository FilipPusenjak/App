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
    const days = (kind: keyof typeof PLUS_QUOTA) => {
      const d = PLUS_QUOTA[kind];
      if (d === null) throw new Error(`Plus must include ${kind}`);
      return d;
    };
    expect(describeInterval(days("DEEP_REVIEW"))).toBe("monthly");
    expect(describeInterval(days("PROJECTION"))).toBe("weekly");
    expect(describeInterval(days("CHECK_IN"))).toBe("every two days");
  });

  it("gives the free tier strictly less of everything", () => {
    // Otherwise paying for Plus buys nothing, which is worse than not selling it.
    // "Less" now includes "none at all": free carries null for the two runs that
    // cost real money, and null is not a long wait — it is not on the plan.
    for (const kind of RUN_KINDS) {
      const plus = PLUS_QUOTA[kind];
      const free = FREE_QUOTA[kind];
      expect(plus).toEqual(expect.any(Number));
      if (free !== null) expect(free).toBeGreaterThan(plus as number);
    }
  });

  it("keeps the expensive runs off the free plan entirely", () => {
    // Anyone can sign up — there is no invite list — so a free tier that
    // included these would let a stranger spend the deployment's model budget.
    expect(FREE_QUOTA).toEqual({
      DEEP_REVIEW: null,
      PROJECTION: null,
      CHECK_IN: 14,
    });
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
      expect(decision.reason).toBe("interval");
      // A date somebody can plan around, not a countdown they have to convert.
      expect(decision.nextAvailableAt?.toISOString()).toBe(
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

describe("a run the plan does not include", () => {
  it("refuses the very first one, not just a repeat", () => {
    // The bug this exists to stop: reusing the interval code's "no last run
    // means go ahead" exemption for null, which would ship every free account
    // one free Deep Review — precisely the run being removed.
    const decision = checkQuota({
      kind: "DEEP_REVIEW",
      lastRunAt: null,
      policy: FREE_QUOTA,
      creditsAvailable: 0,
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
  });

  it("does not name a date, because waiting will not help", () => {
    const decision = checkQuota({
      kind: "PROJECTION",
      lastRunAt: null,
      policy: FREE_QUOTA,
      creditsAvailable: 0,
      now: NOW,
    });
    if (decision.allowed) throw new Error("expected a refusal");
    expect(decision.reason).toBe("not-on-plan");
    expect(decision.nextAvailableAt).toBeNull();
    expect(decision.message).toMatch(/Plus/);
    expect(decision.message).toMatch(/code/i);
    // No invented far-future date dressed up as a schedule.
    expect(decision.message).not.toMatch(/\b20\d\d\b/);
  });

  it("still lets a code through — that is the whole point of codes", () => {
    // Handing out codes is how somebody tries the app without a card. If the
    // plan gate ran ahead of credits, every code issued would be inert.
    expect(
      checkQuota({
        kind: "DEEP_REVIEW",
        lastRunAt: null,
        policy: FREE_QUOTA,
        creditsAvailable: 1,
        now: NOW,
      }),
    ).toEqual({ allowed: true, usingCredit: true });
  });

  it("leaves the check-in working on free", () => {
    // Free is not meant to be a dead account; the cheap run stays.
    expect(
      checkQuota({
        kind: "CHECK_IN",
        lastRunAt: null,
        policy: FREE_QUOTA,
        creditsAvailable: 0,
        now: NOW,
      }),
    ).toEqual({ allowed: true, usingCredit: false });
  });

  it("shows it on the plan page as a plan difference, not a wait", () => {
    const standing = standingFor({
      kind: "DEEP_REVIEW",
      lastRunAt: null,
      policy: FREE_QUOTA,
      credits: 0,
      now: NOW,
    });
    expect(standing.includedInPlan).toBe(false);
    expect(standing.availableNow).toBe(false);
    expect(standing.nextAvailableAt).toBeNull();
    expect(standing.intervalLabel).toBe("not on your plan");
  });

  it("says available now when a code covers it", () => {
    // Otherwise the page reads "not on your plan" directly beside a badge
    // saying this account holds a code for exactly that run.
    const standing = standingFor({
      kind: "DEEP_REVIEW",
      lastRunAt: null,
      policy: FREE_QUOTA,
      credits: 1,
      now: NOW,
    });
    expect(standing.availableNow).toBe(true);
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
      policy: PLUS_QUOTA,
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
