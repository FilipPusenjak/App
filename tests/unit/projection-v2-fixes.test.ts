// The five defects projection/v2 fixes, all reported from a real run.
//
// Written against the symptoms that appeared on screen, not the implementation:
// invented baselines that contradicted the one measured number, numbers that
// drifted between runs, a phantom "Ireland rubric", rubric ids shown to the
// student, and low effort.
import { describe, expect, it } from "vitest";
import { buildProjectionSnapshot } from "@/lib/evaluation/projection-snapshot";
import type { PreviousProjection } from "@/lib/evaluation/projection-previous";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompts/projection";
import {
  DEFAULT_PROJECTION_EFFORT,
  DEFAULT_EFFORT,
} from "@/lib/anthropic";

const profile = {
  gradeLevel: "Grade 9",
  schoolName: "Some School",
  schoolContext: null,
  curriculum: "ap",
  gpa: 3.9,
  gpaScale: "4.0",
  intendedMajor: "Medicine",
  careerGoal: "Astronaut",
  testScores: [],
  resumeItems: [
    {
      id: "r1",
      type: "volunteering",
      title: "Clinical shadowing (one day)",
      org: null,
      description: null,
      startDate: null,
      endDate: null,
      hoursPerWeek: null,
      evidenceNotes: null,
    },
  ],
  targetSchools: [
    { name: "Oxford", country: "GB", course: "Medicine", classification: null, priority: null, notes: null },
    { name: "Cornell", country: "US", course: "Biology", classification: null, priority: null, notes: null },
    // The target that exposed the phantom-rubric bug. Ireland has had a rubric
    // since the EU one shipped, so the guard now uses a country that genuinely
    // has none — the bug was inventing "the Ireland rubric" out of a country
    // name, and that is just as available for Japan.
    { name: "University of Tokyo", country: "JP", course: "Medicine", classification: null, priority: null, notes: null },
  ],
};

const plans = [
  {
    id: "p1",
    type: "leadership",
    title: "Start a Fragrance Club",
    org: null,
    description: null,
    targetDate: null,
    hoursPerWeek: 1,
  },
];

/** The exact situation from the reported run: overall 32, no per-system data. */
function snapshotWithOverallOnly() {
  return buildProjectionSnapshot(profile, "US", plans, {
    evaluationId: "eval-old",
    capturedAt: "2026-07-20T00:00:00.000Z",
    overallScore: 32,
    systemReadiness: {},
  });
}

function snapshotWithMeasured() {
  return buildProjectionSnapshot(profile, "US", plans, {
    evaluationId: "eval-new",
    capturedAt: "2026-07-29T00:00:00.000Z",
    overallScore: 32,
    systemReadiness: { "us-holistic": 35, "uk-course-specific": 28, generic: 30 },
  });
}

// ── Fix 1: invented baselines that contradicted the measured number ─────────
describe("current readiness is anchored, not invented", () => {
  it("anchors estimated per-system numbers to the one measured overall", () => {
    // The reported bug: told overall was 32, it produced 22, 30, 30 — all below
    // 32, reconciling with nothing.
    const prompt = buildUserPrompt(snapshotWithOverallOnly());
    expect(prompt).toMatch(/ANCHORED TO 32/);
    expect(prompt).toMatch(/some above and some below/i);
    expect(prompt).toMatch(/Do not produce a set of numbers that all sit well below 32/);
  });

  it("requires saying the starting number was an estimate, not a measurement", () => {
    const prompt = buildUserPrompt(snapshotWithOverallOnly());
    expect(prompt).toMatch(/your estimate, not a measurement/i);
    expect(prompt).toMatch(/re-running their evaluation will give the projection a real baseline/i);
  });

  it("uses measured per-system numbers verbatim when they exist", () => {
    const prompt = buildUserPrompt(snapshotWithMeasured());
    expect(prompt).toContain("us-holistic: 35");
    expect(prompt).toContain("uk-course-specific: 28");
    expect(prompt).toMatch(/Use these EXACTLY as currentReadiness/);
    // And it must not also tell the model to estimate.
    expect(prompt).not.toMatch(/ANCHORED TO/);
  });

  it("says so when there is no evaluation at all", () => {
    const prompt = buildUserPrompt(
      buildProjectionSnapshot(profile, "US", plans, {
        evaluationId: null,
        capturedAt: null,
        overallScore: null,
        systemReadiness: {},
      }),
    );
    expect(prompt).toMatch(/no measured baseline at all/i);
  });

  it("forbids inventing a current score the app already knows", () => {
    expect(SYSTEM_PROMPT).toMatch(/Current readiness is not yours to invent/);
    expect(SYSTEM_PROMPT).toMatch(/USE IT VERBATIM/);
  });
});

// ── Fix 2: no bands, no memory ───────────────────────────────────────────────
describe("projections are anchored across runs", () => {
  const previous: PreviousProjection = {
    capturedAt: "2026-07-29T00:00:00.000Z",
    planTitles: ["Start a Fragrance Club"],
    projectedByRubric: { "us-holistic": 40, "uk-course-specific": 25 },
    worthByPlanTitle: { "Start a Fragrance Club": "low" },
    addedPlans: [],
    removedPlans: [],
    plansUnchanged: true,
  };

  it("defines what a number means, which v1 did not", () => {
    expect(SYSTEM_PROMPT).toMatch(/Readiness is a PERCENTILE/);
    expect(SYSTEM_PROMPT).toMatch(/stronger than roughly 90%/);
  });

  it("passes the previous projection's numbers and verdicts back in", () => {
    const prompt = buildUserPrompt(snapshotWithMeasured(), previous);
    expect(prompt).toContain("us-holistic: 40");
    expect(prompt).toContain("Start a Fragrance Club: low");
  });

  it("demands identical output when the plan list is unchanged", () => {
    const prompt = buildUserPrompt(snapshotWithMeasured(), previous);
    expect(prompt).toMatch(/THE PLAN LIST IS UNCHANGED/);
    expect(prompt).toMatch(/every worthDoing verdict must be the same/i);
  });

  it("allows movement only where plans actually changed", () => {
    const prompt = buildUserPrompt(snapshotWithMeasured(), {
      ...previous,
      addedPlans: ["Sit the UCAT"],
      removedPlans: [],
      plansUnchanged: false,
    });
    expect(prompt).toMatch(/ADDED since last time: Sit the UCAT/);
    expect(prompt).toMatch(/Only the numbers these changes actually affect should move/i);
  });

  it("says plainly when this is the first projection", () => {
    const prompt = buildUserPrompt(snapshotWithMeasured(), null);
    expect(prompt).toMatch(/this is the student's first projection/i);
  });

  it("requires an explanation of any difference", () => {
    expect(SYSTEM_PROMPT).toMatch(/changeSinceLastProjection/);
    expect(SYSTEM_PROMPT).toMatch(/Consistency between projections/);
  });
});

// ── Fix 3: the phantom "Ireland rubric" ──────────────────────────────────────
describe("rubric mapping names the rubric actually applied", () => {
  it("does not invent a national rubric for a country that has none", () => {
    const prompt = buildUserPrompt(snapshotWithMeasured());
    expect(prompt).not.toMatch(/Japan rubric/);
    expect(prompt).toContain("University of Tokyo (Japan) ->");
    expect(prompt).toMatch(/no country-specific rubric exists for this country/i);
  });

  it("tells the model not to imply a national rubric was used", () => {
    expect(SYSTEM_PROMPT).toMatch(/Do not imply a national rubric exists when it does not/);
  });
});

// ── Fix 4: rubric ids leaking into the student-facing output ────────────────
describe("student-facing fields carry school names, not internal ids", () => {
  it("spells out what wouldMoveNeedleFor must contain", () => {
    expect(SYSTEM_PROMPT).toMatch(/Name schools, never rubric ids/);
    expect(SYSTEM_PROMPT).toMatch(/Never put a rubric id like "us-holistic"/);
    expect(SYSTEM_PROMPT).toMatch(/shown to the student verbatim/);
  });
});

// ── Fix 5: effort too low to be consistent ──────────────────────────────────
describe("projection effort", () => {
  it("is no longer the least consistent setting", () => {
    expect(DEFAULT_PROJECTION_EFFORT).toBe("medium");
    expect(DEFAULT_PROJECTION_EFFORT).not.toBe("low");
  });

  it("still matches the evaluation's effort level at most", () => {
    const order = ["low", "medium", "high", "xhigh", "max"];
    expect(order.indexOf(DEFAULT_PROJECTION_EFFORT)).toBeLessThanOrEqual(
      order.indexOf(DEFAULT_EFFORT),
    );
  });
});
