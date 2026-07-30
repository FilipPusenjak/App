// Stage awareness and percentile scoring — prompt v5.
//
// The complaint: a Grade 9 student was being judged as though their profile
// were a finished application, and told their biggest gap was having no
// admissions test score two years before they could sit one. The rubrics had
// no concept of stage at all — every dimension described the finish line.
//
// The tests below check both halves of the fix: that stage is now modelled,
// and that modelling it did NOT turn the evaluation into flattery.
import { describe, expect, it } from "vitest";
import {
  genericRubric,
  renderRubric,
  ukRubric,
  usRubric,
  type Rubric,
} from "@/lib/rubrics";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompts/evaluation";
import { SYSTEM_PROMPT as PROJECTION_PROMPT } from "@/lib/prompts/projection";
import { buildSnapshot } from "@/lib/evaluation/snapshot";

const ALL: Rubric[] = [usRubric, ukRubric, genericRubric];

function snapshot(gradeLevel: string) {
  return buildSnapshot(
    {
      gradeLevel,
      schoolName: "Some School",
      schoolContext: null,
      curriculum: "ap",
      gpa: 3.9,
      gpaScale: "4.0",
      intendedMajor: "Medicine",
      careerGoal: null,
      testScores: [],
      resumeItems: [],
      targetSchools: [
        { name: "Oxford", country: "GB", course: "Medicine", classification: null, priority: null, notes: null },
        { name: "Cornell", country: "US", course: "Biology", classification: null, priority: null, notes: null },
      ],
    },
    "US",
  );
}

describe("every rubric carries a stage ladder", () => {
  it.each(ALL.map((r) => [r.id, r] as const))(
    "%s defines early, middle and final stages",
    (_id, rubric) => {
      expect(rubric.stages.map((s) => s.key)).toEqual([
        "early",
        "middle",
        "final",
      ]);
    },
  );

  it.each(ALL.map((r) => [r.id, r] as const))(
    "%s says what each stage is FOR and what is gated at it",
    (_id, rubric) => {
      for (const stage of rubric.stages) {
        expect(stage.purpose.length).toBeGreaterThan(40);
        expect(stage.evidence.length).toBeGreaterThan(0);
        expect(stage.notYetExpected.length).toBeGreaterThan(0);
      }
    },
  );

  it("treats admissions tests and research as gated in the early years", () => {
    const early = usRubric.stages.find((s) => s.key === "early")!;
    const gated = early.notYetExpected.join(" ").toLowerCase();
    expect(gated).toMatch(/test scores/);
    expect(gated).toMatch(/research/);
    expect(gated).toMatch(/leadership titles/);
  });

  it("treats UK admissions tests and personal statements as final-year items", () => {
    const early = ukRubric.stages.find((s) => s.key === "early")!;
    const gated = early.notYetExpected.join(" ").toLowerCase();
    expect(gated).toMatch(/ucat|admissions test/);
    expect(gated).toMatch(/personal statement/);
    expect(gated).toMatch(/predicted grades/);
  });

  it("still expects real, reachable things in the early years", () => {
    // The guard against this becoming "nothing is expected of you".
    const early = usRubric.stages.find((s) => s.key === "early")!;
    const evidence = early.evidence.join(" ").toLowerCase();
    expect(evidence).toMatch(/demanding courses/);
    expect(evidence).toMatch(/sustained|stuck with/);
    expect(early.evidence.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the stage ladder reaches the prompt", () => {
  it("renders stages, with the not-yet-reachable list marked as not a gap", () => {
    const text = renderRubric(usRubric);
    expect(text).toContain("Stage ladder");
    expect(text).toMatch(/NOT YET REACHABLE at this stage/);
    expect(text).toMatch(/absence is NOT a gap/);
    expect(text).toMatch(/must not lower the stage-relative score/);
  });

  it("warns that the dimensions describe a COMPLETED application", () => {
    const text = renderRubric(ukRubric);
    expect(text).toMatch(/these describe a COMPLETED application/);
  });

  it("appears in the assembled evaluation prompt", () => {
    const prompt = buildUserPrompt(snapshot("Grade 9"));
    expect(prompt).toContain("Stage ladder");
    expect(prompt).toMatch(/Early — Grade 9-10/);
  });
});

describe("the evaluation prompt uses stage without going soft", () => {
  it("forbids listing a gated item as a gap", () => {
    expect(SYSTEM_PROMPT).toMatch(/is NOT a gap/);
    expect(SYSTEM_PROMPT).toMatch(/do not let its absence lower gradeRelativeScore/i);
  });

  it("names research as the clearest gated example", () => {
    expect(SYSTEM_PROMPT).toMatch(/Research is the clearest example/);
    expect(SYSTEM_PROMPT).toMatch(/upstream of it, not behind/);
  });

  it("EXPLICITLY refuses to let stage-fairness become an excuse", () => {
    // The failure mode of this whole change.
    expect(SYSTEM_PROMPT).toMatch(/do not turn this into an excuse/i);
    expect(SYSTEM_PROMPT).toMatch(/REACHABLE NOW AND NOT STARTED/);
    expect(SYSTEM_PROMPT).toMatch(/Do not let stage-fairness soften/i);
  });

  it("keeps 'behind' available as a verdict when reachable things aren't done", () => {
    expect(SYSTEM_PROMPT).toMatch(/Judging "behind" is legitimate/);
    expect(SYSTEM_PROMPT).toMatch(/judge it on what was reachable, never on what was locked/);
  });

  it("requires gap timing", () => {
    expect(SYSTEM_PROMPT).toMatch(/Gaps carry timing/);
    expect(SYSTEM_PROMPT).toMatch(/"now", "soon" or "later"/);
  });

  it("asks for both present helpfulness and foundational value", () => {
    expect(SYSTEM_PROMPT).toMatch(/Items have two different values/);
    expect(SYSTEM_PROMPT).toMatch(/foundationalValue/);
    expect(SYSTEM_PROMPT).toMatch(/compoundsInto/);
    // The compounding example that makes the distinction concrete.
    expect(SYSTEM_PROMPT).toMatch(/Grade 9 that becomes a leadership role/);
  });

  it("notes the two values converge for a final-year student", () => {
    expect(SYSTEM_PROMPT).toMatch(/final-year student the two converge/);
  });

  it("forbids actions gated behind years of prerequisites", () => {
    expect(SYSTEM_PROMPT).toMatch(/Never tell an early-years student to do something gated/);
  });
});

describe("scores are percentiles", () => {
  it("defines overallScore as placement among applicants", () => {
    expect(SYSTEM_PROMPT).toMatch(/Both scores are PERCENTILES/);
    expect(SYSTEM_PROMPT).toMatch(/stronger than roughly 90% of that applicant pool/);
    expect(SYSTEM_PROMPT).toMatch(/not the general population, and not the admitted class/);
  });

  it("defines gradeRelativeScore as placement among same-stage students", () => {
    expect(SYSTEM_PROMPT).toMatch(/stronger than roughly 90% of students in their year/);
  });

  it("says the two diverging is informative, not contradictory", () => {
    expect(SYSTEM_PROMPT).toMatch(/place LOW on overallScore and can place VERY HIGH/);
    expect(SYSTEM_PROMPT).toMatch(/not a contradiction/);
  });

  it("still forbids naming any acceptance rate when explaining a percentile", () => {
    // The whole reason the selectivity framing lives in the UI, not here.
    expect(SYSTEM_PROMPT).toMatch(
      /Never state, estimate or imply any university's acceptance rate/,
    );
    expect(SYSTEM_PROMPT).toMatch(/This holds when explaining what a percentile means/);
  });
});

describe("the projection prompt got the same treatment", () => {
  it("judges plans against the student's stage", () => {
    expect(PROJECTION_PROMPT).toMatch(/Judge plans against the student's STAGE/);
    expect(PROJECTION_PROMPT).toMatch(/gated at their stage/);
  });

  it("names the exact failure that was reported", () => {
    expect(PROJECTION_PROMPT).toMatch(
      /Telling a 14-year-old their plans do not cover admissions test prep is worthless/,
    );
  });

  it("values early plans by what they compound into", () => {
    expect(PROJECTION_PROMPT).toMatch(/COMPOUNDS INTO/);
  });

  it("still refuses to let stage-fairness become reassurance", () => {
    expect(PROJECTION_PROMPT).toMatch(
      /Stage-fairness is not an excuse to tell a student everything is fine/,
    );
  });

  it("uses percentiles too", () => {
    expect(PROJECTION_PROMPT).toMatch(/Readiness is a PERCENTILE/);
  });
});
