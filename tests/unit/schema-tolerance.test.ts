// Strict about the finding, tolerant about its annotations.
//
// A real evaluation was lost because the model omitted `bestFor` on three item
// assessments. Everything else in that response was complete. The run cost
// $0.34 and was discarded over a list of school names attached to a verdict
// that had already been written.
//
// These fix the line: a response missing an ANNOTATION still parses, and a
// response missing the FINDING still fails. The second half matters as much as
// the first — defaulting a score or a verdict would convert a visible failure
// into a quietly incomplete evaluation, in an app whose whole job is an honest
// number.
import { describe, expect, it } from "vitest";
import { evaluationResultSchema } from "@/lib/validation/evaluation";

/** A complete, valid result. Individual keys get removed per test. */
function complete() {
  return {
    headline: "h",
    summary: "s",
    overallScore: 70,
    gradeRelativeScore: 65,
    gradeContext: "context",
    narrativeCoherence: { score: 60, assessment: "a" },
    changeSinceLast: "No previous evaluation.",
    systemScores: [],
    stageOutlook: {
      stageLabel: "Early — Grade 9-10",
      whatMattersNow: "w",
      onTrack: "on_track",
      assessment: "a",
      reachableNow: ["x"],
      notYetExpected: ["y"],
    },
    strengths: [{ title: "t", detail: "d", relevantTo: ["MIT"] }],
    weaknesses: [],
    schoolFits: [
      {
        schoolName: "MIT",
        course: "CS",
        rubricUsed: "us-holistic",
        selectivity: "extremely_selective",
        fitScore: 55,
        classification: "reach",
        classificationReason: "r",
        assessment: "a",
        keyRisks: ["r"],
      },
    ],
    itemAssessments: [
      {
        itemRef: "0",
        itemTitle: "Olympiad",
        helpfulness: "high",
        foundationalValue: "high",
        compoundsInto: "c",
        verdict: "v",
        howToStrengthen: "h",
        bestFor: ["MIT"],
      },
    ],
    actions: [],
    gaps: [],
    verifyThese: ["check this"],
    proposedCommitments: [
      { description: "Send the write-up to a teacher", targetRung: null, dueInWeeks: 4 },
      { description: "Enter the olympiad", targetRung: "contributor", dueInWeeks: 8 },
    ],
  };
}

describe("annotations may be omitted", () => {
  it("accepts an item assessment with no bestFor — the failure this fixes", () => {
    const input = complete();
    delete (input.itemAssessments[0] as { bestFor?: unknown }).bestFor;
    const parsed = evaluationResultSchema.parse(input);
    expect(parsed.itemAssessments[0].bestFor).toEqual([]);
  });

  it("accepts a strength with no relevantTo", () => {
    const input = complete();
    delete (input.strengths[0] as { relevantTo?: unknown }).relevantTo;
    expect(evaluationResultSchema.parse(input).strengths[0].relevantTo).toEqual([]);
  });

  it("accepts a school fit with no keyRisks", () => {
    const input = complete();
    delete (input.schoolFits[0] as { keyRisks?: unknown }).keyRisks;
    expect(evaluationResultSchema.parse(input).schoolFits[0].keyRisks).toEqual([]);
  });

  it("accepts a result with no verifyThese", () => {
    const input = complete();
    delete (input as { verifyThese?: unknown }).verifyThese;
    expect(evaluationResultSchema.parse(input).verifyThese).toEqual([]);
  });

  it("accepts every annotation missing at once", () => {
    const input = complete();
    delete (input.itemAssessments[0] as { bestFor?: unknown }).bestFor;
    delete (input.strengths[0] as { relevantTo?: unknown }).relevantTo;
    delete (input.schoolFits[0] as { keyRisks?: unknown }).keyRisks;
    delete (input as { verifyThese?: unknown }).verifyThese;
    expect(() => evaluationResultSchema.parse(input)).not.toThrow();
  });
});

describe("the finding itself is still required", () => {
  it("rejects a missing overall score", () => {
    const input = complete();
    delete (input as { overallScore?: unknown }).overallScore;
    expect(() => evaluationResultSchema.parse(input)).toThrow();
  });

  it("rejects an item assessment with no verdict", () => {
    const input = complete();
    delete (input.itemAssessments[0] as { verdict?: unknown }).verdict;
    expect(() => evaluationResultSchema.parse(input)).toThrow();
  });

  it("rejects a school fit with no fit score", () => {
    const input = complete();
    delete (input.schoolFits[0] as { fitScore?: unknown }).fitScore;
    expect(() => evaluationResultSchema.parse(input)).toThrow();
  });

  it("rejects a result with no school fits at all", () => {
    // An empty ANNOTATION is honest; a missing structural array means the
    // question was not answered.
    const input = complete();
    delete (input as { schoolFits?: unknown }).schoolFits;
    expect(() => evaluationResultSchema.parse(input)).toThrow();
  });

  it("rejects a missing summary", () => {
    const input = complete();
    delete (input as { summary?: unknown }).summary;
    expect(() => evaluationResultSchema.parse(input)).toThrow();
  });
});
