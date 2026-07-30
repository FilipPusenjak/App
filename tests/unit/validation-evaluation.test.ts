// The evaluation result contract, in both directions:
//
//   - evaluationResultSchema (strict): what NEW model output must satisfy
//     before anything is written to the database.
//   - storedEvaluationResultSchema (lenient): what SAVED rows are read with.
//     The prompt has been through three versions, and rows produced by v1 and
//     v2 are still in users' histories. They must keep parsing — and fields
//     they never had must come back as undefined/empty, never as fabricated
//     values (a fake gradeRelativeScore of 0 would render as a real score).
import { describe, expect, it } from "vitest";
import {
  evaluationResultSchema,
  parseStoredResult,
  storedEvaluationResultSchema,
} from "@/lib/validation/evaluation";

/** A complete result as prompt v3 produces it. */
function v3Result() {
  return {
    overallScore: 42,
    gradeRelativeScore: 71,
    gradeContext:
      "Strong for Grade 10; the readiness score is low only because applications are two years away.",
    headline: "Solid foundation, big gaps toward the named targets.",
    summary: "A short honest paragraph.",
    strengths: [
      { title: "Sustained sport", detail: "Six years of climbing.", relevantTo: ["all"] },
    ],
    weaknesses: [
      { title: "No evidence in intended field", detail: "Nothing yet.", severity: "significant" },
    ],
    narrativeCoherence: { score: 55, assessment: "Coherent but early." },
    schoolFits: [
      {
        schoolName: "MIT",
        country: "United States",
        course: "Computer Science",
        rubricUsed: "us-holistic",
        fitScore: 30,
        classification: "reach",
        classificationReason: "Admit rates make this a reach for any profile.",
        assessment: "Honest fit text.",
        keyRisks: ["No distinctive spike yet."],
      },
    ],
    itemAssessments: [
      {
        itemRef: "R1",
        itemTitle: "Climbing",
        helpfulness: "moderate",
        verdict: "Real commitment; not field-related.",
        howToStrengthen: "Compete or coach.",
        bestFor: ["MIT"],
      },
    ],
    actions: [
      {
        title: "Enter a CS competition",
        detail: "Evidence in the intended field is the biggest gap.",
        effort: "medium",
        impact: "high",
        timeframe: "this term",
        appliesTo: ["all"],
      },
    ],
    gaps: [{ title: "No test scores", detail: "Nothing recorded.", appliesTo: ["all"] }],
    verifyThese: ["Check each course page for entry requirements."],
  };
}

type Json = Record<string, unknown>;

/** What prompt v2 rows look like: no stage-relative score, no AI classification. */
function v2Result(): Json {
  const v = v3Result() as unknown as Json;
  delete v.gradeRelativeScore;
  delete v.gradeContext;
  v.schoolFits = (v.schoolFits as Json[]).map((fit) => {
    const copy = { ...fit };
    delete copy.classification;
    delete copy.classificationReason;
    return copy;
  });
  return v;
}

/** What prompt v1 (Milestone 5) rows look like: no per-item verdicts, no action plan. */
function v1Result(): Json {
  const v = v2Result();
  delete v.itemAssessments;
  delete v.actions;
  return v;
}

describe("evaluationResultSchema (strict — validates new model output)", () => {
  it("accepts a complete v3 result", () => {
    expect(evaluationResultSchema.safeParse(v3Result()).success).toBe(true);
  });

  it("rejects output missing the v3 fields — new runs may not regress", () => {
    expect(evaluationResultSchema.safeParse(v2Result()).success).toBe(false);
    expect(evaluationResultSchema.safeParse(v1Result()).success).toBe(false);
  });

  it("rejects an invalid classification value", () => {
    const bad = v3Result();
    bad.schoolFits[0]!.classification = "sure thing" as never;
    expect(evaluationResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid helpfulness value", () => {
    const bad = v3Result();
    bad.itemAssessments[0]!.helpfulness = "amazing" as never;
    expect(evaluationResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe("storedEvaluationResultSchema (lenient — reads saved rows)", () => {
  it("still parses a v1 row, defaulting what v1 never had", () => {
    const parsed = storedEvaluationResultSchema.parse(v1Result());
    expect(parsed.itemAssessments).toEqual([]);
    expect(parsed.actions).toEqual([]);
    // Undefined, NOT 0 — the UI must omit the section, not show a fake score.
    expect(parsed.gradeRelativeScore).toBeUndefined();
    expect(parsed.gradeContext).toBeUndefined();
    expect(parsed.schoolFits[0]!.classification).toBeUndefined();
  });

  it("still parses a v2 row, keeping its item assessments and actions", () => {
    const parsed = storedEvaluationResultSchema.parse(v2Result());
    expect(parsed.itemAssessments).toHaveLength(1);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.gradeRelativeScore).toBeUndefined();
    expect(parsed.schoolFits[0]!.classification).toBeUndefined();
  });

  it("parses a v3 row with everything intact", () => {
    const parsed = storedEvaluationResultSchema.parse(v3Result());
    expect(parsed.gradeRelativeScore).toBe(71);
    expect(parsed.schoolFits[0]!.classification).toBe("reach");
  });
});

describe("parseStoredResult (what the pages actually call)", () => {
  it("round-trips a stored JSON string", () => {
    const parsed = parseStoredResult(JSON.stringify(v3Result()));
    expect(parsed?.overallScore).toBe(42);
  });

  it("parses stored v1 JSON — old evaluations must never render blank", () => {
    const parsed = parseStoredResult(JSON.stringify(v1Result()));
    expect(parsed).not.toBeNull();
    expect(parsed!.actions).toEqual([]);
  });

  it("returns null for null (failed evaluations have no result)", () => {
    expect(parseStoredResult(null)).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseStoredResult("{ not json")).toBeNull();
  });

  it("returns null for valid JSON of the wrong shape", () => {
    expect(parseStoredResult(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseStoredResult(JSON.stringify([1, 2, 3]))).toBeNull();
  });
});
