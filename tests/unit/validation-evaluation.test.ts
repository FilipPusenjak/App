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

/** A complete result as the CURRENT prompt (v6) produces it. */
function v6Result() {
  return {
    overallScore: 42,
    gradeRelativeScore: 71,
    gradeContext:
      "Strong for Grade 10; the readiness score is low only because applications are two years away.",
    systemScores: [
      {
        rubricId: "us-holistic",
        systemLabel: "United States — holistic review",
        readinessScore: 48,
        gradeRelativeScore: 74,
        assessment:
          "Breadth and the sustained climbing commitment carry real weight here.",
      },
      {
        rubricId: "uk-course-specific",
        systemLabel: "United Kingdom — course-specific admissions",
        readinessScore: 33,
        gradeRelativeScore: 60,
        assessment:
          "Course-specific evidence is thin, and breadth counts for little on a UK application.",
      },
    ],
    changeSinceLast:
      "You added two items and nothing was removed; readiness moved 39 -> 42 on the strength of the new competition result.",
    stageOutlook: {
      stageLabel: "Early — Grade 9-10",
      whatMattersNow:
        "Building things that can still be running in three years, and taking the hardest courses actually on offer.",
      onTrack: "on_track",
      assessment:
        "Foundations are real: six years of climbing shows you finish things. Nothing in the intended field yet, which is the thing to start.",
      reachableNow: ["Sustained volunteering", "A long-running project of your own"],
      notYetExpected: ["Admissions test scores", "Published research"],
    },
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
        selectivity: "extremely_selective",
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
        foundationalValue: "high",
        compoundsInto:
          "Six years in, a coaching role or a competition record would make this a genuine distinguishing strength.",
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
    gaps: [
      {
        title: "No evidence in the intended field",
        detail: "Nothing yet that speaks to the subject.",
        timing: "now",
        appliesTo: ["all"],
      },
      {
        title: "No admissions test score",
        detail: "You cannot sit these for two more years.",
        timing: "later",
        appliesTo: ["all"],
      },
    ],
    verifyThese: ["Check each course page for entry requirements."],
    proposedCommitments: [
      { description: "Send the write-up to a teacher", targetRung: null, dueInWeeks: 4 },
      { description: "Enter the olympiad", targetRung: "contributor", dueInWeeks: 8 },
    ],
  };
}

type Json = Record<string, unknown>;

/** What prompt v5 rows look like: no selectivity read on any target. */
function v5Result(): Json {
  const v = v6Result() as unknown as Json;
  v.schoolFits = (v.schoolFits as Json[]).map((fit) => {
    const copy = { ...fit };
    delete copy.selectivity;
    return copy;
  });
  return v;
}

/** What prompt v4 rows look like: no stage reading, no gap timing. */
function v4Result(): Json {
  const v = v5Result();
  delete v.stageOutlook;
  v.gaps = (v.gaps as Json[]).map((g) => {
    const copy = { ...g };
    delete copy.timing;
    return copy;
  });
  v.itemAssessments = (v.itemAssessments as Json[]).map((i) => {
    const copy = { ...i };
    delete copy.foundationalValue;
    delete copy.compoundsInto;
    return copy;
  });
  return v;
}

/** What prompt v3 rows look like: one blended score, no change explanation. */
function v3Result(): Json {
  const v = v4Result();
  delete v.systemScores;
  delete v.changeSinceLast;
  return v;
}

/** What prompt v2 rows look like: no stage-relative score, no AI classification. */
function v2Result(): Json {
  const v = v3Result();
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
  it("accepts a complete v6 result", () => {
    expect(evaluationResultSchema.safeParse(v6Result()).success).toBe(true);
  });

  it("rejects output from every older prompt — new runs may not regress", () => {
    expect(evaluationResultSchema.safeParse(v5Result()).success).toBe(false);
    expect(evaluationResultSchema.safeParse(v4Result()).success).toBe(false);
    expect(evaluationResultSchema.safeParse(v3Result()).success).toBe(false);
    expect(evaluationResultSchema.safeParse(v2Result()).success).toBe(false);
    expect(evaluationResultSchema.safeParse(v1Result()).success).toBe(false);
  });

  it("requires the stage reading — judging a student stage-blind is the bug", () => {
    const bad = v6Result() as unknown as Json;
    delete bad.stageOutlook;
    expect(evaluationResultSchema.safeParse(bad).success).toBe(false);
  });

  it("requires timing on every gap, so locked doors aren't shown as failings", () => {
    const bad = v6Result() as unknown as Json;
    bad.gaps = (bad.gaps as Json[]).map((g) => {
      const copy = { ...g };
      delete copy.timing;
      return copy;
    });
    expect(evaluationResultSchema.safeParse(bad).success).toBe(false);
  });

  it("requires foundational value on items, not just present helpfulness", () => {
    const bad = v6Result() as unknown as Json;
    bad.itemAssessments = (bad.itemAssessments as Json[]).map((i) => {
      const copy = { ...i };
      delete copy.foundationalValue;
      return copy;
    });
    expect(evaluationResultSchema.safeParse(bad).success).toBe(false);
  });

  it("requires per-system scores — a single blended number is the bug", () => {
    const bad = v6Result() as unknown as Json;
    delete bad.systemScores;
    expect(evaluationResultSchema.safeParse(bad).success).toBe(false);
  });

  it("requires the change explanation", () => {
    const bad = v6Result() as unknown as Json;
    delete bad.changeSinceLast;
    expect(evaluationResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid classification value", () => {
    const bad = v6Result();
    bad.schoolFits[0]!.classification = "sure thing" as never;
    expect(evaluationResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid helpfulness value", () => {
    const bad = v6Result();
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

  it("still parses a v3 row, with no per-system scores invented", () => {
    const parsed = storedEvaluationResultSchema.parse(v3Result());
    expect(parsed.gradeRelativeScore).toBe(71);
    expect(parsed.schoolFits[0]!.classification).toBe("reach");
    // Empty, not a fabricated system breakdown that was never assessed.
    expect(parsed.systemScores).toEqual([]);
    expect(parsed.changeSinceLast).toBeUndefined();
  });

  it("still parses a v4 row, with no stage reading invented", () => {
    const parsed = storedEvaluationResultSchema.parse(v4Result());
    expect(parsed.systemScores).toHaveLength(2);
    // Absent, not fabricated — the UI omits the stage section for old rows.
    expect(parsed.stageOutlook).toBeUndefined();
    expect(parsed.gaps[0]!.timing).toBeUndefined();
    expect(parsed.itemAssessments[0]!.foundationalValue).toBeUndefined();
  });

  it("still parses a v5 row, with no selectivity invented", () => {
    const parsed = storedEvaluationResultSchema.parse(v5Result());
    expect(parsed.stageOutlook?.onTrack).toBe("on_track");
    // Absent, not guessed — the UI omits the tier rather than asserting one
    // that no evaluation ever made.
    expect(parsed.schoolFits[0]!.selectivity).toBeUndefined();
    expect(parsed.schoolFits[0]!.fitScore).toBe(30);
  });

  it("parses a v6 row with everything intact", () => {
    const parsed = storedEvaluationResultSchema.parse(v6Result());
    expect(parsed.schoolFits[0]!.selectivity).toBe("extremely_selective");
    expect(parsed.stageOutlook?.onTrack).toBe("on_track");
    expect(parsed.gaps.map((g) => g.timing)).toEqual(["now", "later"]);
    expect(parsed.itemAssessments[0]!.foundationalValue).toBe("high");
    expect(parsed.systemScores).toHaveLength(2);
    expect(parsed.systemScores.map((s) => s.rubricId)).toEqual([
      "us-holistic",
      "uk-course-specific",
    ]);
    // The two systems must be able to disagree — that's the point.
    expect(parsed.systemScores[0]!.readinessScore).not.toBe(
      parsed.systemScores[1]!.readinessScore,
    );
    expect(parsed.changeSinceLast).toContain("39 -> 42");
  });
});

describe("parseStoredResult (what the pages actually call)", () => {
  it("round-trips a stored JSON string", () => {
    const parsed = parseStoredResult(JSON.stringify(v6Result()));
    expect(parsed?.overallScore).toBe(42);
    expect(parsed?.systemScores).toHaveLength(2);
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
