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

  // ── Era-accurate rows ────────────────────────────────────────────────────
  //
  // The version loop above pairs an OLD version string with a MODERN result,
  // so it exercises the branch that picks a schema and nothing else. That is
  // why it stayed green while the reader was in fact refusing every genuine
  // pre-v6 row: the fixture had fields those rows have never had.
  //
  // A fixture that is modern in everything but its label proves the reader can
  // read today's JSON. Only a fixture missing what the era was missing proves
  // it can read a student's actual history.

  /** As v1 wrote them: no gradeRelativeScore, no systemScores, no stage. */
  const v1Result = {
    overallScore: 58,
    headline: "An early headline.",
    summary: "A summary.",
    strengths: [],
    weaknesses: [],
    narrativeCoherence: { score: 70, assessment: "ok" },
    schoolFits: [
      {
        schoolName: "Imperial",
        course: "Computing",
        rubricUsed: "uk_course",
        country: "United Kingdom",
        fitScore: 64,
        assessment: "A stretch.",
        keyRisks: [],
      },
    ],
    gaps: [],
    verifyThese: [],
  };

  it("reads a v1-era row, which has no gradeRelativeScore at all", () => {
    const shape = readStoredEvaluation({
      promptVersion: "evaluation/v1",
      resultJson: JSON.stringify(v1Result),
    });
    expect(shape.kind).toBe("legacy");
    if (shape.kind !== "legacy") throw new Error("unreachable");
    // Absent, not zero. A defaulted 0 here would be a percentile nothing
    // measured, shown to a student as though someone had judged them.
    expect(shape.result.gradeRelativeScore).toBeUndefined();
    expect(shape.result.overallScore).toBe(58);
  });

  it("reads a v5-era row, whose school fits predate selectivity", () => {
    // `selectivity` and `classification` arrived in v6. Validating this row
    // against the schema the model must satisfy TODAY rejects it, and the
    // detail page then tells the student "no result was stored" about a row
    // that is entirely intact.
    const shape = readStoredEvaluation({
      promptVersion: "evaluation/v5",
      resultJson: JSON.stringify({
        ...v1Result,
        gradeRelativeScore: 81,
        gradeContext: "ctx",
      }),
    });
    expect(shape.kind).toBe("legacy");
    if (shape.kind !== "legacy") throw new Error("unreachable");
    expect(shape.result.schoolFits[0]?.selectivity).toBeUndefined();
    // The country older prompts asked for is still carried, so the UI can
    // show it on the rows that have it.
    expect(shape.result.schoolFits[0]?.country).toBe("United Kingdom");
  });

  it("still refuses JSON that is not an evaluation at all", () => {
    // Tolerance has a floor: reading old rows must not become accepting
    // anything. If this passes, the reader has stopped validating.
    const shape = readStoredEvaluation({
      promptVersion: "evaluation/v5",
      resultJson: JSON.stringify({ hello: "world" }),
    });
    expect(shape.kind).toBe("none");
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
