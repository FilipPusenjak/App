// The guarantees the two evaluation tiers rest on.
//
// Most of these are not about output quality — they are about the boundaries
// that make the tiers honest: that a check-in genuinely receives less, that
// nothing material means nothing spent, that a threshold cannot be exceeded,
// and that no output can ever tell a teenager their odds.
import { describe, expect, it } from "vitest";
import {
  buildCheckInContext,
  CHECK_IN_TOKEN_BUDGET,
} from "@/lib/evaluation/context/check-in";
import { detectMaterialChange } from "@/lib/evaluation/material-change";
import {
  checkInNarrativeSchema,
  deepReviewNarrativeSchema,
  findBannedPhrasing,
  TIER_LABELS,
} from "@/lib/validation/tiers";
import { scoreProfile, parseGradeLevel } from "@/lib/readiness/score";
import { buildThresholdSnapshot, thresholdBand } from "@/lib/readiness/threshold";
import { feasibility, monthsUntilApplication, readPace } from "@/lib/readiness/pace";
import type { ProfileDigestSummary } from "@/lib/evaluation/digest";

const NOW = new Date("2026-08-18T00:00:00Z");

function item(over: Partial<Parameters<typeof scoreProfile>[0]["resumeItems"][number]> = {}) {
  return {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    title: "Robotics Club",
    type: "extracurricular",
    description: null,
    evidenceNotes: null,
    startDate: new Date("2025-09-01T00:00:00Z"),
    endDate: null,
    hoursPerWeek: 2,
    ...over,
  };
}

const academics = {
  gpa: 3.8,
  gpaScale: "4.0",
  curriculum: "AP",
  testScores: [],
  subjects: [],
};

const scored = (over: Partial<Parameters<typeof scoreProfile>[0]> = {}) =>
  scoreProfile({
    gradeLevel: 11,
    academics,
    resumeItems: [item()],
    requirements: [],
    now: NOW,
    ...over,
  });

describe("check-in context stays inside its budget", () => {
  /** Four years of history, compacted, as a 12th grader would have. */
  function seniorDigests(): ProfileDigestSummary[] {
    return [9, 10, 11].map((grade) => ({
      throughGrade: grade,
      activities: Array.from({ length: 8 }, (_, n) => ({
        title: `Activity ${grade}-${n} with a fairly long descriptive name`,
        type: "extracurricular",
        rung: "sustained" as const,
        months: 12,
        substance:
          "Ran the weekly sessions and organised the regional showcase, which about sixty students attended.",
      })),
      academics: {
        gpa: 3.9,
        gpaScale: "4.0",
        curriculum: "AP",
        testScores: [{ label: "SAT", score: "1500", predicted: false }],
      },
    }));
  }

  it("holds under 4k tokens for a 12th grader with four years behind them", () => {
    // The whole reason digests exist: a senior's weekly check-in must not cost
    // several times a freshman's, or a flat four-year subscription loses money
    // on exactly the students who stayed.
    const built = buildCheckInContext({
    developments: [],
      scored: scored({
        gradeLevel: 12,
        resumeItems: Array.from({ length: 10 }, (_, n) =>
          item({ title: `Current activity ${n}` }),
        ),
      }),
      changes: Array.from({ length: 6 }, (_, n) => ({
        kind: "edited" as const,
        what: `change ${n}`,
      })),
      openCommitments: Array.from({ length: 4 }, (_, n) => ({
        id: `c${n}`,
        description: "Finish the write-up and put it somewhere linkable",
        status: "ACCEPTED",
        dueDate: NOW,
      })),
      digests: seniorDigests(),
      precedingAt: new Date("2026-08-01T00:00:00Z"),
      now: NOW,
    });

    expect(built.estimatedTokens).toBeLessThanOrEqual(CHECK_IN_TOKEN_BUDGET);
  });

  it("stays well under budget even with ten items to summarise", () => {
    // The check-in is the cheap tier, and it is cheap because of what it is
    // NOT given. A context that grew with the profile would quietly turn the
    // fortnightly rhythm into a second full review at full price.
    const s = scored({
      resumeItems: Array.from({ length: 10 }, (_, n) => item({ title: `A${n}` })),
    });
    const checkIn = buildCheckInContext({
      developments: [],
      scored: s,
      changes: [],
      openCommitments: [],
      digests: seniorDigests(),
      precedingAt: NOW,
      now: NOW,
    });
    expect(checkIn.estimatedTokens).toBeLessThanOrEqual(CHECK_IN_TOKEN_BUDGET);
  });

  it("never puts raw prior-year entries in a check-in", () => {
    const built = buildCheckInContext({
    developments: [],
      scored: scored(),
      changes: [],
      openCommitments: [],
      digests: seniorDigests(),
      precedingAt: NOW,
      now: NOW,
    });
    // Digest lines are summarised; the marker for a compacted year is present
    // and the raw-entry shape ("Evidence:", "Description:") is not.
    expect(built.text).toContain("Earlier years (summarised)");
    expect(built.text).not.toContain("Evidence:");
  });
});

describe("the no-change path", () => {
  const previous = {
    thresholdBand: "not checked",
    differentiationBand: "developing",
    paceStatus: "ON_PACE",
    rungs: {} as Record<string, string>,
  };

  it("reports no material change when genuinely nothing moved", () => {
    const s = scored();
    const verdict = detectMaterialChange({
      scored: s,
      previous: {
        ...previous,
        thresholdBand: s.thresholdBand,
        differentiationBand: s.differentiation.band,
        paceStatus: s.pace.status,
        rungs: Object.fromEntries(
          s.differentiation.activities.map((a) => [a.id, a.rung]),
        ),
      },
      changeCount: 0,
      openCommitments: [],
      now: NOW,
    });
    expect(verdict.material).toBe(false);
    expect(verdict.reasons).toEqual([]);
  });

  it("always runs the first check-in, which has no baseline to be unchanged from", () => {
    expect(
      detectMaterialChange({
        scored: scored(),
        previous: null,
        changeCount: 0,
        openCommitments: [],
        now: NOW,
      }).material,
    ).toBe(true);
  });

  it("treats a rung moving as material even when the band did not", () => {
    // The smallest real progress the app can see. Missing it would tell a
    // student who just became captain that nothing happened.
    const s = scored();
    const activity = s.differentiation.activities[0]!;
    const verdict = detectMaterialChange({
      scored: s,
      previous: {
        thresholdBand: s.thresholdBand,
        differentiationBand: s.differentiation.band,
        paceStatus: s.pace.status,
        rungs: { [activity.id]: "none" },
      },
      changeCount: 0,
      openCommitments: [],
      now: NOW,
    });
    expect(verdict.material).toBe(true);
    expect(verdict.reasons.join(" ")).toContain(activity.title);
  });

  it("treats a commitment coming due as material on its own", () => {
    const s = scored();
    const verdict = detectMaterialChange({
      scored: s,
      previous: {
        thresholdBand: s.thresholdBand,
        differentiationBand: s.differentiation.band,
        paceStatus: s.pace.status,
        rungs: Object.fromEntries(
          s.differentiation.activities.map((a) => [a.id, a.rung]),
        ),
      },
      changeCount: 0,
      openCommitments: [
        { dueDate: new Date(NOW.getTime() + 3 * 86_400_000), status: "ACCEPTED" },
      ],
      now: NOW,
    });
    expect(verdict.material).toBe(true);
  });
});

describe("output shapes", () => {
  it("permits exactly one action on a check-in, structurally", () => {
    // A string, not an array, so five actions cannot be represented at all.
    const ok = checkInNarrativeSchema.safeParse({
      headline: "You moved the robotics project up a rung.",
      movement: { direction: "UP", driver: "Ran the spring workshop." },
      nextRung: null,
      actionThisFortnight: "Email the club lead about running the next session.",
      commitmentPrompts: [],
    });
    expect(ok.success).toBe(true);

    const many = checkInNarrativeSchema.safeParse({
      headline: "h",
      movement: { direction: "FLAT", driver: null },
      nextRung: null,
      actionThisFortnight: ["one", "two"],
      commitmentPrompts: [],
    });
    expect(many.success).toBe(false);
  });

  it("reads a retired review's commitments without policing the count", () => {
    // This schema is now a READER — the tier that produced these rows is
    // retired, so nothing validates a fresh response against it. A `.min(2)`
    // here can only refuse to render something already stored, which is the
    // failure this surface has been fixed for twice.
    const base = {
      headline: "A one-sentence headline.",
      sinceLastReview: "Baseline.",
      trajectory: { assessment: "a", direction: "STEADY" },
      coherence: { assessment: "a", incoherences: [] },
      differentiation: { assessment: "a", escalationOpportunities: [] },
      gaps: [],
    };
    const one = deepReviewNarrativeSchema.safeParse({
      ...base,
      proposedCommitments: [
        { description: "d", targetRung: null, dueInWeeks: 4 },
      ],
    });
    expect(one.success).toBe(true);

    const many = deepReviewNarrativeSchema.safeParse({
      ...base,
      proposedCommitments: Array.from({ length: 6 }, () => ({
        description: "d",
        targetRung: null,
        dueInWeeks: 4,
      })),
    });
    expect(many.success).toBe(true);
  });

  it("never surfaces a model name to the user", () => {
    expect(TIER_LABELS.CHECK_IN).toBe("Check-In");
    expect(TIER_LABELS.DEEP_REVIEW).toBe("Deep Review");
    for (const label of Object.values(TIER_LABELS)) {
      expect(label.toLowerCase()).not.toMatch(/opus|sonnet|haiku|claude|gpt/);
    }
  });
});

describe("no output may state odds", () => {
  it("catches every form of admission probability", () => {
    // Hedged, ranged, or comparative — all of it. A teenager will carry an
    // invented number around as though someone knew it.
    const banned = [
      { headline: "You have a 12% chance." },
      { headline: "Roughly comparable to admitted students at 8 percent." },
      { headline: "Your odds are good." },
      { headline: "The likelihood of admission is moderate." },
      { headline: "Their acceptance rate is low." },
      { headline: "You will get into Cambridge." },
      { headline: "About 1 in 5 applicants" },
    ];
    for (const value of banned) {
      expect(findBannedPhrasing(value).length).toBeGreaterThan(0);
    }
  });

  it("passes the language the app is supposed to use", () => {
    const fine = {
      headline: "Requirements are mostly met; differentiation moved to competitive.",
      action: "Ask your teacher which olympiads the school enters.",
      gap: "No sustained science thread yet — three terms would build one.",
    };
    expect(findBannedPhrasing(fine)).toEqual([]);
  });
});

describe("threshold components cap at met", () => {
  const requirement = {
    targetName: "University of Oxford",
    course: "Medicine (A100)",
    primarySourceUrl: "https://www.ox.ac.uk/x",
    requirements: {
      admissionsTest: {
        value: "UCAT required",
        quote: "All applicants must take the UCAT admissions test.",
        sourceUrl: "https://www.ox.ac.uk/t",
      },
    },
  };

  it("cannot exceed MET however much the student does", () => {
    // The entire reason threshold and differentiation are separate outputs: a
    // bar that could be over-satisfied would let depth paper over a gap.
    const one = buildThresholdSnapshot(
      { ...academics, testScores: [{ kind: "ucat", label: "UCAT", score: "2900", predicted: false }] },
      [requirement],
    );
    const many = buildThresholdSnapshot(
      {
        ...academics,
        testScores: [
          { kind: "ucat", label: "UCAT", score: "3300", predicted: false },
          { kind: "bmat", label: "BMAT", score: "6.5", predicted: false },
          { kind: "sat", label: "SAT", score: "1600", predicted: false },
        ],
      },
      [requirement],
    );
    expect(one.schools[0]!.components[0]!.state).toBe("MET");
    expect(many.schools[0]!.components[0]!.state).toBe("MET");
    expect(thresholdBand(many)).toBe("met");
    // "met" is the top of the band list — there is nothing above it.
    expect(thresholdBand(many)).toBe(thresholdBand(one));
  });

  it("says 'not checked' rather than 'met' when there is no data", () => {
    const empty = buildThresholdSnapshot(academics, []);
    expect(empty.noDataForAnyTarget).toBe(true);
    expect(thresholdBand(empty)).toBe("not checked");
  });

  it("refuses to adjudicate grades across incomparable notations", () => {
    // "A*AA" against a 4.0 GPA is not arithmetic anyone can do honestly, so it
    // resolves to UNKNOWN and the model is told to say so.
    const snapshot = buildThresholdSnapshot(academics, [
      {
        ...requirement,
        requirements: {
          gradeRequirement: {
            value: "A*AA at A level",
            quote: "The typical offer is A*AA at A level.",
            sourceUrl: "https://www.ox.ac.uk/g",
          },
        },
      },
    ]);
    expect(snapshot.schools[0]!.components[0]!.state).toBe("UNKNOWN");
  });
});

describe("grade-aware feasibility", () => {
  it("never calls a multi-year commitment FEASIBLE for a 12th grader", () => {
    // A hard filter, not a tone adjustment. Softening the wording of an
    // impossible suggestion still leaves a senior told to start something they
    // cannot finish.
    const monthsLeft = monthsUntilApplication(12);
    for (const monthsNeeded of [18, 24, 36]) {
      expect(feasibility(monthsNeeded, monthsLeft)).not.toBe("FEASIBLE");
    }
    expect(feasibility(24, monthsLeft)).toBe("TOO_LATE");
  });

  it("does call the same thing FEASIBLE for a 9th grader", () => {
    expect(feasibility(24, monthsUntilApplication(9))).toBe("FEASIBLE");
  });

  it("is TIGHT rather than absolute when the grade is unknown", () => {
    expect(feasibility(24, null)).toBe("TIGHT");
  });
});

describe("pace never presents being young as underperformance", () => {
  it("puts a 9th grader who has joined things ON_PACE", () => {
    // Their readiness is structurally low because most of their profile has
    // not happened. That is arithmetic, and calling it BEHIND is the single
    // easiest way for this product to do harm.
    const reading = readPace({
      gradeLevel: 9,
      topRungIndex: 1,
      sustainedThreadCount: 1,
    });
    expect(reading.status).toBe("ON_PACE");
  });

  it("makes no comparison at all when the grade is unknown", () => {
    const reading = readPace({
      gradeLevel: null,
      topRungIndex: 0,
      sustainedThreadCount: 0,
    });
    expect(reading.unknownGrade).toBe(true);
  });

  it("reads free-text grade levels, and refuses to guess when it cannot", () => {
    expect(parseGradeLevel("Grade 11")).toBe(11);
    expect(parseGradeLevel("Year 13")).toBe(12);
    expect(parseGradeLevel("sixth form")).toBeNull();
    expect(parseGradeLevel(null)).toBeNull();
  });
});
