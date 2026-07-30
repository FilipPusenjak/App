// Projections: the "what if I did these things" path.
//
// The defining property is separation — a projection is a hypothetical and must
// never be mistaken for, or mixed into, the student's real record. That shows up
// here as: its own schema, its own prompt, and prompt text that hammers "none of
// this has happened yet".
import { describe, expect, it } from "vitest";
import { buildProjectionSnapshot } from "@/lib/evaluation/projection-snapshot";
import { buildSampleProjection } from "@/lib/evaluation/projection-sample";
import {
  parseStoredProjection,
  projectionResultSchema,
} from "@/lib/validation/projection";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  PROMPT_VERSION,
} from "@/lib/prompts/projection";
import {
  DEFAULT_PROJECTION_MODEL,
  DEFAULT_MODEL,
  getProjectionModel,
} from "@/lib/anthropic";

const profile = {
  gradeLevel: "Grade 11",
  schoolName: "Riverside High",
  schoolContext: "8 APs, no IB.",
  curriculum: "ap",
  gpa: 3.85,
  gpaScale: "4.0",
  intendedMajor: "Computer Science",
  careerGoal: null,
  testScores: [
    { kind: "sat", label: "SAT", score: "1480", maxScore: "1600", predicted: false },
  ],
  resumeItems: [
    {
      id: "r1",
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
  targetSchools: [
    { name: "MIT", country: "US", course: "CS", classification: null, priority: null, notes: null },
    { name: "Cambridge", country: "GB", course: "CS", classification: null, priority: null, notes: null },
  ],
};

const plans = [
  {
    id: "p1",
    type: "leadership",
    title: "Start a competitive programming club",
    org: "school",
    description: "Weekly through the year, enter two regional contests.",
    targetDate: new Date("2026-09-01T00:00:00Z"),
    hoursPerWeek: 2,
  },
  {
    id: "p2",
    type: "award",
    title: "Sit the national maths olympiad",
    org: null,
    description: null,
    targetDate: null,
    hoursPerWeek: null,
  },
];

const baseline = {
  evaluationId: "eval-1",
  capturedAt: "2026-07-01T00:00:00.000Z",
  overallScore: 45,
  systemReadiness: { "us-holistic": 48, "uk-course-specific": 33 },
};

const snapshot = () =>
  buildProjectionSnapshot(profile, "US", plans, baseline);

describe("buildProjectionSnapshot", () => {
  it("gives plans stable short refs in order", () => {
    expect(snapshot().plannedItems.map((p) => p.ref)).toEqual(["P1", "P2"]);
    expect(snapshot().plannedItems.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("embeds the real profile untouched, so plans can't contaminate it", () => {
    const snap = snapshot();
    expect(snap.profile.resumeItems).toHaveLength(1);
    expect(snap.profile.resumeItems[0]!.title).toBe("Climbing");
    // The plans are NOT in the achieved list.
    const achievedTitles = snap.profile.resumeItems.map((i) => i.title);
    expect(achievedTitles).not.toContain("Start a competitive programming club");
  });

  it("carries the measured baseline so movement is from a real number", () => {
    expect(snapshot().baseline).toMatchObject({
      evaluationId: "eval-1",
      overallScore: 45,
      systemReadiness: { "us-holistic": 48, "uk-course-specific": 33 },
    });
  });

  it("flattens target dates to YYYY-MM-DD", () => {
    expect(snapshot().plannedItems[0]!.targetDate).toBe("2026-09-01");
    expect(snapshot().plannedItems[1]!.targetDate).toBeNull();
  });
});

describe("the projection prompt", () => {
  it("has a version id, recorded on every projection row", () => {
    expect(PROMPT_VERSION).toBe("projection/v3");
  });

  it("insists planning is not doing — the central guard against false comfort", () => {
    expect(SYSTEM_PROMPT).toMatch(/Planning is not doing/i);
    expect(SYSTEM_PROMPT).toMatch(/Intending to do something is worth nothing/i);
    expect(SYSTEM_PROMPT).toMatch(/conditional on/i);
  });

  it("forbids inflating projections to be motivating", () => {
    expect(SYSTEM_PROMPT).toMatch(/Do not inflate the projected figures/i);
    expect(SYSTEM_PROMPT).toMatch(/daydreaming/i);
  });

  it("requires blunt verdicts on plans that aren't worth doing", () => {
    expect(SYSTEM_PROMPT).toMatch(/negligible/);
    expect(SYSTEM_PROMPT).toMatch(/not worth it|not worth/i);
  });

  it("keeps the hours-are-not-commitment correction", () => {
    expect(SYSTEM_PROMPT).toMatch(/hour a week is the normal cadence/i);
  });

  it("scores each admissions system separately", () => {
    expect(SYSTEM_PROMPT).toMatch(/systemProjections/);
    expect(SYSTEM_PROMPT).toMatch(/very different amounts/i);
  });

  it("keeps the no-invented-statistics rules", () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER state or estimate acceptance rates/);
    expect(SYSTEM_PROMPT).toMatch(/Never predict admission outcomes/);
  });

  it("marks the plans as not yet done, and separates them from the profile", () => {
    const prompt = buildUserPrompt(snapshot());
    expect(prompt).toMatch(/CURRENT profile — already achieved/);
    expect(prompt).toMatch(/PLANNING to do — none of this has happened/);
    expect(prompt).toContain("[P1]");
    expect(prompt).toContain("[P2]");
  });

  it("passes a measured baseline through and forbids re-deriving it", () => {
    const prompt = buildUserPrompt(snapshot());
    expect(prompt).toContain("us-holistic: 48");
    expect(prompt).toContain("uk-course-specific: 33");
    expect(prompt).toMatch(/MEASURED readiness per admissions system/);
    expect(prompt).toMatch(/Use these EXACTLY as currentReadiness/);
  });

  it("handles having no baseline evaluation yet", () => {
    const noBase = buildProjectionSnapshot(profile, "US", plans, {
      evaluationId: null,
      capturedAt: null,
      overallScore: null,
      systemReadiness: {},
    });
    const prompt = buildUserPrompt(noBase);
    expect(prompt).toMatch(/No completed evaluation exists yet/);
    expect(prompt).toMatch(/running a real evaluation first/i);
  });

  it("includes both rubrics for mixed US/UK targets", () => {
    const prompt = buildUserPrompt(snapshot());
    expect(prompt).toContain("id: us-holistic");
    expect(prompt).toContain("id: uk-course-specific");
  });
});

describe("projections run on a cheaper model than evaluations", () => {
  it("defaults to Sonnet, not the evaluation model", () => {
    expect(DEFAULT_PROJECTION_MODEL).toBe("claude-sonnet-5");
    expect(DEFAULT_PROJECTION_MODEL).not.toBe(DEFAULT_MODEL);
  });

  it("is overridable by environment", () => {
    expect(getProjectionModel()).toBe(DEFAULT_PROJECTION_MODEL);
  });
});

describe("buildSampleProjection", () => {
  it("satisfies the strict schema real output must satisfy", () => {
    expect(projectionResultSchema.safeParse(buildSampleProjection(snapshot())).success).toBe(
      true,
    );
  });

  it("assesses every plan", () => {
    const result = buildSampleProjection(snapshot());
    expect(result.planAssessments.map((p) => p.planRef)).toEqual(["P1", "P2"]);
  });

  it("produces one entry per admissions system", () => {
    const result = buildSampleProjection(snapshot());
    expect(result.systemProjections.map((s) => s.rubricId)).toEqual([
      "us-holistic",
      "uk-course-specific",
    ]);
  });

  it("starts from the measured baseline and projects no movement", () => {
    const result = buildSampleProjection(snapshot());
    const us = result.systemProjections.find((s) => s.rubricId === "us-holistic")!;
    expect(us.currentReadiness).toBe(48);
    // A sample must never imply progress it did not calculate.
    expect(us.projectedReadiness).toBe(48);
  });

  it("labels itself as a sample", () => {
    const result = buildSampleProjection(snapshot());
    expect(result.headline).toMatch(/SAMPLE/);
    expect(result.cautions.join(" ")).toMatch(/nothing on a plan list has happened/i);
  });
});

describe("parseStoredProjection", () => {
  it("round-trips a stored projection", () => {
    const json = JSON.stringify(buildSampleProjection(snapshot()));
    expect(parseStoredProjection(json)?.systemProjections).toHaveLength(2);
  });

  it("returns null for null, malformed JSON, and the wrong shape", () => {
    expect(parseStoredProjection(null)).toBeNull();
    expect(parseStoredProjection("{ not json")).toBeNull();
    expect(parseStoredProjection(JSON.stringify({ nope: true }))).toBeNull();
  });
});
