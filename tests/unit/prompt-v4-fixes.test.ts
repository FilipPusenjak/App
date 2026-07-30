// The three defects prompt v4 exists to fix, each reported from real output.
//
// These are the tests that would have caught the original bugs, so they are
// written against the behaviour a student actually complained about rather than
// against the implementation.
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import { buildDiff } from "@/lib/evaluation/diff";
import { renderPreviousContext, renderSnapshot } from "@/lib/prompts/evaluation/render";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompts/evaluation";
import { usRubric, ukRubric, renderRubric } from "@/lib/rubrics";

function snapshotWith(
  items: {
    title: string;
    hoursPerWeek?: number | null;
    org?: string | null;
  }[],
  extras?: { gpa?: number | null; targets?: { name: string; country: string }[] },
) {
  // Deliberately not `?? 3.8`: the tests need to express "GPA cleared".
  const gpa = extras && "gpa" in extras ? extras.gpa! : 3.8;
  return buildSnapshot(
    {
      gradeLevel: "Grade 11",
      schoolName: "Riverside High",
      schoolContext: "8 APs offered, no IB.",
      curriculum: "ap",
      gpa,
      gpaScale: "4.0",
      intendedMajor: "Computer Science",
      careerGoal: null,
      testScores: [
        { kind: "sat", label: "SAT", score: "1480", maxScore: "1600", predicted: false },
      ],
      resumeItems: items.map((i, n) => ({
        id: `item-${n}`,
        type: "extracurricular",
        title: i.title,
        org: i.org ?? null,
        description: null,
        startDate: null,
        endDate: null,
        hoursPerWeek: i.hoursPerWeek ?? null,
        evidenceNotes: null,
      })),
      targetSchools: (
        extras?.targets ?? [
          { name: "MIT", country: "US" },
          { name: "Cambridge", country: "GB" },
        ]
      ).map((t) => ({
        ...t,
        course: "Computer Science",
        classification: null,
        priority: null,
        notes: null,
      })),
    },
    "US",
  );
}

// ── Defect 1: a 1hr/week club was being read as low commitment ──────────────
describe("weekly hours are not treated as a commitment score", () => {
  it("the snapshot tells the model an hour a week is normal for a club", () => {
    const text = renderSnapshot(snapshotWith([{ title: "Robotics Club", hoursPerWeek: 1 }]));
    expect(text).toMatch(/hour a week is the standard cadence for a school club/i);
    expect(text).toMatch(/not a measure of quality|is CONTEXT/i);
  });

  it("the system prompt forbids ranking items by hours", () => {
    expect(SYSTEM_PROMPT).toMatch(/Never rank items by hours/i);
    expect(SYSTEM_PROMPT).toMatch(/the hours alone are not/i);
  });

  it("the US rubric says hours must not drive the rating", () => {
    const text = renderRubric(usRubric);
    expect(text).toMatch(/WEEKLY HOURS ARE A WEAK SIGNAL/);
    expect(text).toMatch(/normal cadence/i);
  });

  it("the UK rubric discounts clubs on relevance, never on hours", () => {
    const text = renderRubric(ukRubric);
    expect(text).toMatch(/never the number of hours per week/i);
  });

  it("still allows calling an item weak for short duration with no outcome", () => {
    // The fix must not become "never criticize an activity".
    expect(SYSTEM_PROMPT).toMatch(/short-lived, unevidenced, no role, no outcome/i);
    expect(SYSTEM_PROMPT).toMatch(/Call weak items weak/);
  });
});

// ── Defect 2: adding work could LOWER the score ─────────────────────────────
describe("scores cannot fall when the profile only gained content", () => {
  const before = snapshotWith([{ title: "Robotics Club", hoursPerWeek: 1 }]);
  const after = snapshotWith([
    { title: "Robotics Club", hoursPerWeek: 1 },
    { title: "State Programming Competition — 3rd place" },
  ]);
  const scores = {
    overallScore: 45,
    gradeRelativeScore: 70,
    fitScores: { MIT: 30, Cambridge: 25 },
  };

  it("detects that content was only added", () => {
    const diff = buildDiff(before, after, scores);
    expect(diff.addedItems).toEqual(["State Programming Competition — 3rd place"]);
    expect(diff.removedItems).toEqual([]);
    expect(diff.onlyGained).toBe(true);
    expect(diff.unchanged).toBe(false);
  });

  it("tells the model in the strongest terms that the score must not drop", () => {
    const text = renderPreviousContext(buildDiff(before, after, scores))!;
    expect(text).toMatch(/MUST NOT FALL/);
    expect(text).toMatch(/telling them a lie/i);
  });

  it("still permits a justified drop, but requires naming the cause", () => {
    const text = renderPreviousContext(buildDiff(before, after, scores))!;
    expect(text).toMatch(/one exception/i);
    expect(text).toMatch(/name that specific addition/i);
  });

  it("passes the previous scores through so the model can be consistent", () => {
    const text = renderPreviousContext(buildDiff(before, after, scores))!;
    expect(text).toContain("overallScore: 45");
    expect(text).toContain("gradeRelativeScore: 70");
    expect(text).toContain("MIT: 30");
    expect(text).toContain("Cambridge: 25");
  });

  it("demands stability when nothing changed at all", () => {
    const diff = buildDiff(before, before, scores);
    expect(diff.unchanged).toBe(true);
    const text = renderPreviousContext(diff)!;
    expect(text).toMatch(/PROFILE IS UNCHANGED/);
    expect(text).toMatch(/stay essentially the same/i);
  });

  it("does not claim 'only gained' when something was removed", () => {
    const diff = buildDiff(after, before, scores);
    expect(diff.removedItems).toEqual(["State Programming Competition — 3rd place"]);
    expect(diff.onlyGained).toBe(false);
    expect(renderPreviousContext(diff)!).not.toMatch(/MUST NOT FALL/);
  });

  it("treats a cleared field as a removal, not a gain", () => {
    const withGpa = snapshotWith([{ title: "Club" }], { gpa: 3.9 });
    const withoutGpa = snapshotWith([{ title: "Club" }], { gpa: null });
    const diff = buildDiff(withGpa, withoutGpa, scores);
    expect(diff.changedFields.some((c) => c.includes("GPA"))).toBe(true);
    expect(diff.onlyGained).toBe(false);
  });

  it("treats a FALLING GPA as a weakening, so the score may legitimately drop", () => {
    const diff = buildDiff(
      snapshotWith([{ title: "Club" }], { gpa: 3.9 }),
      snapshotWith([{ title: "Club" }], { gpa: 3.4 }),
      scores,
    );
    expect(diff.changedFields).toContain("GPA: 3.9 -> 3.4");
    expect(diff.onlyGained).toBe(false);
  });

  it("a RISING GPA is still a gain", () => {
    const diff = buildDiff(
      snapshotWith([{ title: "Club" }], { gpa: 3.4 }),
      snapshotWith([{ title: "Club" }], { gpa: 3.9 }),
      scores,
    );
    expect(diff.onlyGained).toBe(true);
  });

  it("says plainly when there is no previous evaluation", () => {
    expect(renderPreviousContext(null)).toBeNull();
    const prompt = buildUserPrompt(after, null);
    expect(prompt).toMatch(/None — this is the student's first evaluation/);
  });

  it("defines what a number means so it is stable between runs", () => {
    // The root cause of drift: v3 never said what 50 meant. v5 makes both
    // scores percentiles, which is checkable rather than vibes.
    expect(SYSTEM_PROMPT).toMatch(/Both scores are PERCENTILES/);
    expect(SYSTEM_PROMPT).toMatch(/stronger than roughly 90%/);
    expect(SYSTEM_PROMPT).toMatch(/squarely mid-pack/i);
  });
});

// ── Defect 3: one blended score across two different systems ────────────────
describe("US and UK are scored separately", () => {
  it("asks for one entry per admissions system, never blended", () => {
    expect(SYSTEM_PROMPT).toMatch(/Score each admissions system separately/);
    expect(SYSTEM_PROMPT).toMatch(/never blended/i);
    expect(SYSTEM_PROMPT).toMatch(/systemScores/);
  });

  it("warns that the two systems should be expected to diverge", () => {
    expect(SYSTEM_PROMPT).toMatch(/diverge/i);
  });

  it("keeps the headline consistent with the per-system numbers", () => {
    expect(SYSTEM_PROMPT).toMatch(/should not sit outside the range the systems span/i);
  });

  it("includes both rubrics for a mixed US/UK target list", () => {
    const prompt = buildUserPrompt(snapshotWith([{ title: "Club" }]), null);
    expect(prompt).toContain("id: us-holistic");
    expect(prompt).toContain("id: uk-course-specific");
  });
});
