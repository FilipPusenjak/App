// The sample (no-API-key) evaluation must satisfy the SAME strict contract as
// real model output — otherwise the pipeline behaves differently in sample
// mode than in production, and the sample path stops proving anything.
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import { buildSampleResult } from "@/lib/evaluation/sample";
import { evaluationResultSchema } from "@/lib/validation/evaluation";

const snapshot = buildSnapshot(
  {
    gradeLevel: "Grade 11",
    schoolName: null,
    schoolContext: null,
    curriculum: null,
    gpa: null,
    gpaScale: null,
    intendedMajor: null,
    careerGoal: null,
    testScores: [
      { kind: "sat", label: "SAT", score: "1450", maxScore: "1600", predicted: false },
    ],
    resumeItems: [
      {
        id: "item-a",
        type: "project",
        title: "Weather app",
        org: null,
        description: null,
        startDate: null,
        endDate: null,
        hoursPerWeek: null,
        evidenceNotes: null,
      },
    ],
    targetSchools: [
      { name: "MIT", country: "US", course: "CS", classification: null, priority: null, notes: null },
      { name: "Cambridge", country: "GB", course: "CS", classification: null, priority: null, notes: null },
    ],
  },
  null,
);

describe("buildSampleResult", () => {
  it("passes the strict schema used for real model output", () => {
    const result = buildSampleResult(snapshot);
    const parsed = evaluationResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("labels itself as a sample everywhere a student might read", () => {
    const result = buildSampleResult(snapshot);
    expect(result.headline).toMatch(/SAMPLE/i);
    for (const fit of result.schoolFits) {
      expect(fit.assessment).toMatch(/SAMPLE/i);
    }
  });

  it("routes each target through the correct rubric", () => {
    const result = buildSampleResult(snapshot);
    const byName = Object.fromEntries(
      result.schoolFits.map((f) => [f.schoolName, f.rubricUsed]),
    );
    expect(byName["MIT"]).toBe("us-holistic");
    expect(byName["Cambridge"]).toBe("uk-course-specific");
  });

  it("covers every resume item with an item assessment", () => {
    const result = buildSampleResult(snapshot);
    expect(result.itemAssessments.map((a) => a.itemRef)).toEqual(
      snapshot.resumeItems.map((i) => i.ref),
    );
  });

  it("asserts no admissions facts — only placeholder text", () => {
    const result = buildSampleResult(snapshot);
    // The one thing a sample must never do is look like a real judgement.
    expect(result.summary).toMatch(/sample|API key/i);
  });
});
