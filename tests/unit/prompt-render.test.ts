// Prompt rendering — what the model is actually told.
//
// The prompt is the product here, and several behaviors the app promises live
// in this text: the model (not the student) classifies reach/match/safety, GPA
// is judged against school context or flagged as unjudgeable without it, and
// each target is pinned to its own country's rubric so US and UK can't blend.
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import {
  renderRubricMapping,
  renderRubricSection,
  renderSnapshot,
} from "@/lib/prompts/evaluation/render";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/prompts/evaluation";

function makeSnapshot(overrides?: {
  schoolContext?: string | null;
  targets?: { name: string; country: string; course: string | null }[];
}) {
  return buildSnapshot(
    {
      gradeLevel: "Grade 11",
      schoolName: "Riverside High",
      schoolContext: overrides?.schoolContext ?? null,
      curriculum: "ap",
      gpa: 3.8,
      gpaScale: "4.0",
      intendedMajor: "Computer Science",
      careerGoal: null,
      testScores: [
        { kind: "sat", label: "SAT", score: "1450", maxScore: "1600", predicted: true },
      ],
      resumeItems: [
        {
          id: "item-a",
          type: "extracurricular",
          title: "Climbing",
          org: null,
          description: null,
          startDate: null,
          endDate: null,
          hoursPerWeek: 8,
          evidenceNotes: null,
        },
      ],
      targetSchools: (
        overrides?.targets ?? [
          { name: "MIT", country: "US", course: "Computer Science" },
          { name: "Cambridge", country: "GB", course: "Computer Science" },
        ]
      ).map((t) => ({
        ...t,
        classification: null,
        priority: null,
        notes: null,
      })),
    },
    "US",
  );
}

describe("renderSnapshot", () => {
  it("tells the model to classify each target itself", () => {
    const text = renderSnapshot(makeSnapshot());
    // One instruction per target — the student's own guess is never sent.
    const hits = text.match(/YOU must classify this as reach\/match\/safety/g);
    expect(hits).toHaveLength(2);
    expect(text).not.toMatch(/student('s)? classification/i);
  });

  it("includes school context when provided", () => {
    const text = renderSnapshot(
      makeSnapshot({ schoolContext: "Offers 8 APs, no IB, does not rank." }),
    );
    expect(text).toContain("Offers 8 APs, no IB, does not rank.");
    expect(text).not.toContain("NOT PROVIDED");
  });

  it("flags missing school context so GPA is not judged in a vacuum", () => {
    const text = renderSnapshot(makeSnapshot({ schoolContext: null }));
    expect(text).toContain(
      "NOT PROVIDED — say that GPA cannot be fully judged without it",
    );
  });

  it("marks predicted scores and item refs the model must echo back", () => {
    const text = renderSnapshot(makeSnapshot());
    expect(text).toContain("[PREDICTED]");
    expect(text).toContain("[R1]");
  });
});

describe("renderRubricSection", () => {
  it("renders each needed rubric exactly once", () => {
    const text = renderRubricSection(makeSnapshot());
    expect(text.match(/id: us-holistic/g)).toHaveLength(1);
    expect(text.match(/id: uk-course-specific/g)).toHaveLength(1);
  });

  it("uses the UK rubric for a target whose country was stored as the 'UK' alias", () => {
    const text = renderRubricSection(
      makeSnapshot({ targets: [{ name: "Imperial", country: "UK", course: "Physics" }] }),
    );
    expect(text).toContain("id: uk-course-specific");
    expect(text).not.toContain("id: generic");
  });

  it("falls back to the generic rubric for countries without one", () => {
    const text = renderRubricSection(
      makeSnapshot({ targets: [{ name: "ETH Zürich", country: "CH", course: "CS" }] }),
    );
    expect(text).toContain("id: generic");
  });
});

describe("renderRubricMapping", () => {
  it("pins every school to the rubric actually applied, by id", () => {
    const text = renderRubricMapping(makeSnapshot());
    expect(text).toContain("MIT (United States) -> United States — holistic review [id: us-holistic]");
    expect(text).toContain(
      "Cambridge (United Kingdom) -> United Kingdom — course-specific admissions [id: uk-course-specific]",
    );
  });

  it("says plainly when a country has no rubric of its own", () => {
    // The real bug: this used to read "Trinity -> Ireland rubric", naming a
    // rubric that does not exist, while supplying the generic one. The model
    // then produced a section contradicting itself about generic targets.
    const text = renderRubricMapping(
      makeSnapshot({
        targets: [{ name: "Trinity College Dublin", country: "IE", course: "Medicine" }],
      }),
    );
    expect(text).toContain("[id: generic]");
    expect(text).toMatch(/no country-specific rubric exists/i);
    expect(text).not.toMatch(/Ireland rubric/);
  });
});

describe("prompt v10 (the active version)", () => {
  it("has the expected version id — stored on every evaluation row", () => {
    expect(PROMPT_VERSION).toBe("evaluation/v10");
  });

  it("keeps the honesty and no-invented-statistics mandates", () => {
    const combined = SYSTEM_PROMPT + buildUserPrompt(makeSnapshot());
    expect(combined).toMatch(/verifyThese/);
    // Never inventing admissions statistics is a core product requirement.
    expect(combined).toMatch(/statistic/i);
    expect(combined).toMatch(/honest/i);
  });

  it("asks for both scores and explains they measure different things", () => {
    const combined = SYSTEM_PROMPT + buildUserPrompt(makeSnapshot());
    expect(combined).toMatch(/gradeRelativeScore/);
    expect(combined).toMatch(/overallScore/);
    // The distinction itself, not just the field names: the two numbers must
    // be described against DIFFERENT pools, which is what v7 fixed.
    expect(combined).toMatch(/MOST SELECTIVE targets/);
    expect(combined).toMatch(/university-bound students in their year/);
  });

  it("embeds the snapshot, rubric texts, and mapping", () => {
    const prompt = buildUserPrompt(makeSnapshot());
    expect(prompt).toContain("Riverside High");
    expect(prompt).toContain("id: us-holistic");
    expect(prompt).toContain("id: uk-course-specific");
    expect(prompt).toContain("MIT (United States) ->");
  });
});
