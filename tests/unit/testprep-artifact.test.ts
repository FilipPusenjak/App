// The parent-facing artifact's guarantees, and the entitlement rules around it.
//
// This is the surface with the most hostile incentive structure in the product:
// the tutor sends it monthly to the person who pays them. Every test here is
// about a way the document could quietly start serving the tutor's revenue
// instead of the family's understanding.
import { describe, expect, it } from "vitest";
import {
  STOPPING_KINDS,
  artifactOmitsRequiredStoppingNotice,
  findBannedPredictionPhrasing,
  progressNarrativeSchema,
} from "@/lib/validation/testprep";
import {
  CASELOAD_BANDS,
  bandForLimit,
  isGraduated,
  nextBandAbove,
} from "@/lib/testprep/entitlement";
import { PROGRESS_SYSTEM_PROMPT } from "@/lib/prompts/testprep/progress-v1";
import { RUN_BUDGET_USD, MIN_USEFUL_OUTPUT_TOKENS } from "@/lib/cost-budget";

const valid = {
  headline: "Two practice sittings this month, both in the same range.",
  summary:
    "Priya sat two practice tests in October, scoring 1420 and 1440. Her best sections across all sittings are 730 Reading and Writing and 740 Math.",
  focusThisPeriod: "Math",
  stoppingNotice: null,
  whatThisDoesNotTellYou:
    "Practice tests are noisy and a single result is not a reliable reading. A test score is one threshold among several, and clearing it does not decide an admission. This update covers test preparation only.",
};

describe("no output predicts a future score", () => {
  /**
   * The phrasings a model actually reaches for, not the blunt ones. "On track"
   * is first because it is the single most natural thing to write about a
   * student whose scores went up, and it implies both a destination and a
   * timeline the data cannot support.
   */
  const PREDICTIONS = [
    "She is on track for a 1500.",
    "Her projected composite is around 1480.",
    "The trajectory suggests continued improvement.",
    "She should reach 1500 with another month of work.",
    "We expect to hit the target band shortly.",
    "She is likely to reach 1500.",
    "At this pace she will be there by March.",
    "Expect a 1500 by the spring.",
    "Our forecast is a 30-point gain.",
    "She is gaining roughly 20 points per month.",
    "She is on pace to reach her target.",
  ];

  it.each(PREDICTIONS)("catches %j", (text) => {
    expect(
      findBannedPredictionPhrasing({ ...valid, summary: text }).length,
    ).toBeGreaterThan(0);
  });

  it("catches admission likelihood too, for the same reason the student app does", () => {
    expect(
      findBannedPredictionPhrasing({
        ...valid,
        summary: "This puts her chances of admission in a good place.",
      }).length,
    ).toBeGreaterThan(0);
    expect(
      findBannedPredictionPhrasing({ ...valid, summary: "A 1500 guarantees a look." })
        .length,
    ).toBeGreaterThan(0);
  });

  it("walks every field, not just the ones it knows about", () => {
    // A field added to the schema is covered the day it is added.
    expect(
      findBannedPredictionPhrasing({
        ...valid,
        stoppingNotice: "She is on track, so we can stop.",
      }).length,
    ).toBeGreaterThan(0);
  });

  it("leaves honest reporting alone", () => {
    // The cost of a false positive is a paid run discarded, so the patterns have
    // to survive the language a real update is written in.
    expect(
      findBannedPredictionPhrasing({
        headline: "Scores were flat this month.",
        summary:
          "Priya sat two practice tests, scoring 1420 and 1440. That is within the same range as September, so this month did not move her position. Her best Math section remains 740.",
        focusThisPeriod:
          "Math, which has the most room left of any section at 740 out of 800.",
        stoppingNotice:
          "Her superscore of 1470 now clears Duke, which set the highest bar on her list at 1450. More points would not change any admission outcome on this list.",
        whatThisDoesNotTellYou:
          "Practice tests are noisy. A score is one threshold among several and clearing it does not decide an admission.",
      }),
    ).toEqual([]);
  });
});

describe("the artifact's required shape", () => {
  it("accepts an honest update", () => {
    expect(progressNarrativeSchema.safeParse(valid).success).toBe(true);
  });

  it("requires whatThisDoesNotTellYou, every time", () => {
    // The field that stops a rising number being read as an admission forecast.
    const without: Partial<typeof valid> = { ...valid };
    delete without.whatThisDoesNotTellYou;
    expect(progressNarrativeSchema.safeParse(without).success).toBe(false);
    expect(
      progressNarrativeSchema.safeParse({ ...valid, whatThisDoesNotTellYou: "   " })
        .success,
    ).toBe(false);
  });

  it("allows stoppingNotice to be null, because sometimes nothing has fired", () => {
    // Typed nullable on purpose: a required field would push the model to
    // invent a stopping notice for a student who still has work to do.
    expect(progressNarrativeSchema.safeParse({ ...valid, stoppingNotice: null }).success).toBe(
      true,
    );
  });

  it("asks for ONE focus, not a list", () => {
    // A list of four focuses is not a focus, and is what a month of billable
    // work looks like when nobody had to choose.
    const parsed = progressNarrativeSchema.safeParse(valid);
    expect(parsed.success && typeof parsed.data.focusThisPeriod).toBe("string");
  });
});

describe("the stopping notice is mandatory once a signal has fired", () => {
  /**
   * THE most important rule in the product, which is why it lives in a pure
   * function rather than inside the route: a rule trapped in a request handler
   * cannot be tested without an API key, and this one has to be.
   */
  it("refuses an artifact that omits it", () => {
    expect(
      artifactOmitsRequiredStoppingNotice({
        firedKinds: ["ALL_TARGETS_MET"],
        narrative: { ...valid, stoppingNotice: null },
      }),
    ).toBe(true);
  });

  it("refuses one that supplies whitespace, which is the same omission", () => {
    expect(
      artifactOmitsRequiredStoppingNotice({
        firedKinds: ["ALL_TARGETS_MET"],
        narrative: { ...valid, stoppingNotice: "   " },
      }),
    ).toBe(true);
    expect(
      artifactOmitsRequiredStoppingNotice({
        firedKinds: ["MARGINAL_VALUE_ZERO"],
        narrative: { ...valid, stoppingNotice: "" },
      }),
    ).toBe(true);
  });

  it("accepts one that carries it", () => {
    expect(
      artifactOmitsRequiredStoppingNotice({
        firedKinds: ["ALL_TARGETS_MET"],
        narrative: {
          ...valid,
          stoppingNotice:
            "Her superscore now clears Duke, which set the highest bar on her list. More points would not change any admission outcome.",
        },
      }),
    ).toBe(false);
  });

  it("does not demand one when nothing has fired", () => {
    // A required field with nothing to say pushes a model to invent a reason to
    // stop for a student who still has work to do.
    expect(
      artifactOmitsRequiredStoppingNotice({
        firedKinds: [],
        narrative: { ...valid, stoppingNotice: null },
      }),
    ).toBe(false);
  });

  it("holds for every stopping kind, not just the headline one", () => {
    for (const kind of STOPPING_KINDS) {
      expect({
        kind,
        omitted: artifactOmitsRequiredStoppingNotice({
          firedKinds: [kind],
          narrative: { ...valid, stoppingNotice: null },
        }),
      }).toEqual({ kind, omitted: true });
    }
  });
});

describe("the prompt refuses what the model would otherwise supply", () => {
  it("bans predicted scores by name, including the constructions", () => {
    for (const phrase of ["on track", "projected", "should reach", "trajectory"]) {
      expect(PROGRESS_SYSTEM_PROMPT.toLowerCase()).toContain(phrase);
    }
  });

  it("forbids marketing, in those terms", () => {
    expect(PROGRESS_SYSTEM_PROMPT).toMatch(/not marketing|not an advertisement/i);
    expect(PROGRESS_SYSTEM_PROMPT).toMatch(/do not praise the tutor/i);
  });

  it("orders the stopping notice first and forbids softening it", () => {
    expect(PROGRESS_SYSTEM_PROMPT).toMatch(/do not soften it/i);
    expect(PROGRESS_SYSTEM_PROMPT).toMatch(/do not bury it after good news/i);
    // The specific escape hatch a model reaches for when told to report bad news
    // to a paying customer.
    expect(PROGRESS_SYSTEM_PROMPT).toMatch(/reason to continue anyway|keep sharpening/i);
  });

  it("tells the model it computes nothing", () => {
    expect(PROGRESS_SYSTEM_PROMPT).toMatch(/do not recompute/i);
    expect(PROGRESS_SYSTEM_PROMPT).toMatch(/already been computed/i);
  });
});

describe("the artifact is the only model cost, and it is bounded", () => {
  it("has a per-run ceiling well under the counselor edition's prep", () => {
    // The model computes nothing here — it reports numbers it was handed.
    expect(RUN_BUDGET_USD.PROGRESS_ARTIFACT).toBeLessThan(RUN_BUDGET_USD.SESSION_PREP);
    expect(MIN_USEFUL_OUTPUT_TOKENS.PROGRESS_ARTIFACT).toBeGreaterThan(0);
  });
});

describe("caseload bands are soft", () => {
  it("offers the two documented bands", () => {
    expect(CASELOAD_BANDS.map((b) => [b.students, b.monthlyUsd])).toEqual([
      [20, 29],
      [50, 49],
    ]);
  });

  it("suggests the band that would actually cover the overage", () => {
    expect(nextBandAbove(23)?.students).toBe(50);
    expect(nextBandAbove(12)?.students).toBe(20);
    // Above the largest standard band there is no auto-answer — a human talks
    // to them rather than a tier being invented.
    expect(nextBandAbove(80)).toBeNull();
  });

  it("names a band from a limit, for the tutor's own screen", () => {
    expect(bandForLimit(20)?.monthlyUsd).toBe(29);
    expect(bandForLimit(37)).toBeNull();
  });
});

describe("June auto-archive", () => {
  it("archives a leaver once June arrives, and not before", () => {
    // Before June they may still be sitting a summer test.
    expect(isGraduated(2026, new Date("2026-05-31T00:00:00Z"))).toBe(false);
    expect(isGraduated(2026, new Date("2026-06-01T00:00:00Z"))).toBe(true);
  });

  it("archives anyone from an earlier year", () => {
    expect(isGraduated(2025, new Date("2026-01-15T00:00:00Z"))).toBe(true);
  });

  it("leaves a student with no graduation year alone", () => {
    // Guessing would end a live engagement over a blank field.
    expect(isGraduated(null, new Date("2026-07-01T00:00:00Z"))).toBe(false);
  });

  it("does not archive a student who has not got there yet", () => {
    expect(isGraduated(2028, new Date("2026-07-01T00:00:00Z"))).toBe(false);
  });
});
