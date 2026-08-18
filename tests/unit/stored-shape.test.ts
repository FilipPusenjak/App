// Reading evaluations of both shapes.
//
// The property under test is the one that would be worst to get wrong: a
// student's existing evaluations must keep rendering after the output shape
// changed. They are immutable and are never rewritten, so a reader that only
// understood the new shape would not degrade their history — it would lose it.
import { describe, expect, it } from "vitest";
import {
  comparableShapes,
  headlineOf,
  readStoredEvaluation,
} from "@/lib/evaluation/stored-shape";

/** A minimal but valid legacy result, as v1-v10 produced. */
const legacyResult = {
  overallScore: 58,
  gradeRelativeScore: 81,
  gradeContext: "Two different questions.",
  changeSinceLast: "First run.",
  headline: "A legacy evaluation headline.",
  summary: "A summary.",
  stageOutlook: {
    stageLabel: "Grade 11",
    whatMattersNow: "Depth",
    onTrack: "on_track",
    assessment: "Fine",
    reachableNow: [],
    notYetExpected: [],
  },
  systemScores: [],
  strengths: [],
  weaknesses: [],
  narrativeCoherence: { score: 70, assessment: "ok" },
  schoolFits: [],
  itemAssessments: [],
  actions: [],
  gaps: [],
  verifyThese: [],
};

const deepReviewResult = {
  headline: "A deep review headline.",
  sinceLastReview: "Baseline established.",
  trajectory: { assessment: "Steady climb.", direction: "STEADY" },
  coherence: { assessment: "Coherent.", incoherences: [] },
  differentiation: { assessment: "Developing.", escalationOpportunities: [] },
  schoolFits: [],
  itemAssessments: [],
  gaps: [],
  verifyThese: [],
  proposedCommitments: [
    { description: "Enter the olympiad", targetRung: null, dueInWeeks: 8 },
    { description: "Ship the project", targetRung: null, dueInWeeks: 12 },
  ],
};

const checkInResult = {
  headline: "One thing moved.",
  movement: { direction: "UP", driver: "Ran the workshop." },
  nextRung: null,
  actionThisFortnight: "Email the club lead.",
  commitmentPrompts: [],
};

describe("legacy evaluations keep rendering", () => {
  it("reads an evaluation/v10 row", () => {
    const shape = readStoredEvaluation({
      promptVersion: "evaluation/v10",
      resultJson: JSON.stringify(legacyResult),
    });
    expect(shape.kind).toBe("legacy");
    expect(headlineOf(shape)).toBe("A legacy evaluation headline.");
  });

  it("reads every historical version the app has shipped", () => {
    for (let v = 1; v <= 10; v += 1) {
      const shape = readStoredEvaluation({
        promptVersion: `evaluation/v${v}`,
        resultJson: JSON.stringify(legacyResult),
      });
      expect(shape.kind).toBe("legacy");
    }
  });

  it("reads a row written before promptVersion was recorded at all", () => {
    const shape = readStoredEvaluation({
      promptVersion: null,
      resultJson: JSON.stringify(legacyResult),
    });
    expect(shape.kind).toBe("legacy");
  });
});

describe("new shapes", () => {
  it("reads a deep review", () => {
    const shape = readStoredEvaluation({
      promptVersion: "deep-review/v1",
      resultJson: JSON.stringify(deepReviewResult),
    });
    expect(shape.kind).toBe("deep-review");
    expect(headlineOf(shape)).toBe("A deep review headline.");
  });

  it("reads a check-in", () => {
    const shape = readStoredEvaluation({
      promptVersion: "check-in/v1",
      resultJson: JSON.stringify(checkInResult),
    });
    expect(shape.kind).toBe("check-in");
  });

  it("recovers a row whose version string is unrecognised", () => {
    // An unrecorded version must not lose a real result.
    const shape = readStoredEvaluation({
      promptVersion: "something-nobody-registered",
      resultJson: JSON.stringify(deepReviewResult),
    });
    expect(shape.kind).toBe("deep-review");
  });
});

describe("it never mistakes one shape for the other", () => {
  it("does not read a deep review as legacy", () => {
    // Both have "headline", "gaps" and "schoolFits". Duck-typing would
    // misclassify exactly here.
    const shape = readStoredEvaluation({
      promptVersion: "deep-review/v1",
      resultJson: JSON.stringify(deepReviewResult),
    });
    expect(shape.kind).not.toBe("legacy");
  });

  it("does not read a legacy row as a deep review", () => {
    const shape = readStoredEvaluation({
      promptVersion: "evaluation/v10",
      resultJson: JSON.stringify(legacyResult),
    });
    expect(shape.kind).toBe("legacy");
  });
});

describe("degrading safely", () => {
  it("returns none for a failed evaluation with no result", () => {
    expect(
      readStoredEvaluation({ promptVersion: "evaluation/v10", resultJson: null })
        .kind,
    ).toBe("none");
  });

  it("returns none for unparseable JSON rather than throwing", () => {
    expect(() =>
      readStoredEvaluation({ promptVersion: "evaluation/v10", resultJson: "{{{" }),
    ).not.toThrow();
  });

  it("returns none for JSON that matches nothing", () => {
    expect(
      readStoredEvaluation({
        promptVersion: "evaluation/v10",
        resultJson: JSON.stringify({ nonsense: true }),
      }).kind,
    ).toBe("none");
  });
});

describe("shapes are not charted against each other", () => {
  it("refuses to compare a percentile row to a band row", () => {
    // They measure different things. A line drawn between them would show
    // movement that never happened — the same rule as a rubric boundary.
    const legacy = readStoredEvaluation({
      promptVersion: "evaluation/v10",
      resultJson: JSON.stringify(legacyResult),
    });
    const deep = readStoredEvaluation({
      promptVersion: "deep-review/v1",
      resultJson: JSON.stringify(deepReviewResult),
    });
    expect(comparableShapes(legacy, deep)).toBe(false);
    expect(comparableShapes(legacy, legacy)).toBe(true);
    expect(comparableShapes(deep, deep)).toBe(true);
  });

  it("never treats an unreadable row as comparable to anything", () => {
    const none = readStoredEvaluation({ promptVersion: null, resultJson: null });
    expect(comparableShapes(none, none)).toBe(false);
  });
});
