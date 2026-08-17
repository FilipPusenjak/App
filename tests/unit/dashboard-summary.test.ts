// What the dashboard decides to say, tested away from the JSX.
//
// Two things here are correctness rather than presentation: which gaps are
// worth showing a student, and whether two scores may honestly be subtracted.
// Getting the second wrong would put a number on the front page describing a
// change that never happened to them.
import { describe, expect, it } from "vitest";
import {
  describeMovement,
  findProfileGaps,
  isEvaluationStale,
  scoreMovement,
  type GapInput,
} from "@/lib/dashboard/summary";
import { VERSION_HISTORY } from "@/lib/prompts/evaluation/versions";

const complete: GapInput = {
  gradeLevel: "Grade 11",
  schoolContext: "Offers 8 APs, no IB, does not rank.",
  targets: [{ name: "MIT", country: "US", course: "Computer Science" }],
  resumeItemCount: 4,
};

const ids = (input: Partial<GapInput>) =>
  findProfileGaps({ ...complete, ...input }).map((g) => g.id);

describe("which gaps are worth showing", () => {
  it("says nothing when the profile is ready", () => {
    expect(findProfileGaps(complete)).toEqual([]);
  });

  it("flags having no targets as blocking", () => {
    const gaps = findProfileGaps({ ...complete, targets: [] });
    expect(gaps[0]!.id).toBe("no-targets");
    expect(gaps[0]!.blocking).toBe(true);
  });

  it("flags an empty resume as blocking", () => {
    expect(ids({ resumeItemCount: 0 })).toContain("no-items");
  });

  it("flags missing school context, which the prompt cannot judge GPA without", () => {
    expect(ids({ schoolContext: null })).toContain("no-school-context");
    expect(ids({ schoolContext: "   " })).toContain("no-school-context");
  });

  it("flags targets with no course, and names them", () => {
    const gaps = findProfileGaps({
      ...complete,
      targets: [
        { name: "Cambridge", country: "GB", course: null },
        { name: "Oxford", country: "GB", course: "" },
        { name: "MIT", country: "US", course: "Computer Science" },
      ],
    });
    const gap = gaps.find((g) => g.id === "targets-without-course")!;
    expect(gap.label).toContain("2 targets");
    expect(gap.why).toContain("Cambridge");
    expect(gap.why).toContain("Oxford");
    // The one that IS named must not be listed as a problem.
    expect(gap.why).not.toContain("MIT");
  });

  it("does not list more than three names before summarising", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      name: `School ${i}`,
      country: "GB",
      course: null,
    }));
    const gap = findProfileGaps({ ...complete, targets: many }).find(
      (g) => g.id === "targets-without-course",
    )!;
    expect(gap.why).toContain("and 3 more");
  });

  it("NEVER asks a student for test scores", () => {
    // The stage model exists so a 14-year-old is not told to fix something two
    // years out of reach. A dashboard that nags for an SAT undoes that.
    const everything = findProfileGaps({
      gradeLevel: null,
      schoolContext: null,
      targets: [],
      resumeItemCount: 0,
    });
    const text = JSON.stringify(everything).toLowerCase();
    expect(text).not.toContain("sat");
    expect(text).not.toContain("test score");
    expect(text).not.toContain("gpa is missing");
  });

  it("puts the blocking gaps first", () => {
    const gaps = findProfileGaps({
      gradeLevel: null,
      schoolContext: null,
      targets: [],
      resumeItemCount: 0,
    });
    const firstNonBlocking = gaps.findIndex((g) => !g.blocking);
    const lastBlocking = gaps.map((g) => g.blocking).lastIndexOf(true);
    expect(lastBlocking).toBeLessThan(firstNonBlocking);
  });

  it("phrases every gap as a consequence, not a telling-off", () => {
    const gaps = findProfileGaps({
      gradeLevel: null,
      schoolContext: null,
      targets: [],
      resumeItemCount: 0,
    });
    for (const gap of gaps) {
      expect(gap.why).not.toMatch(/you (must|should|need to|failed)/i);
      expect(gap.why.length).toBeGreaterThan(20);
    }
  });
});

describe("comparing this run to the last one", () => {
  const v = (name: string) => name;
  const current = VERSION_HISTORY[VERSION_HISTORY.length - 1]!.version;

  it("calls the first evaluation a baseline rather than a change", () => {
    expect(scoreMovement({ score: 62, promptVersion: current }, null)).toEqual({
      kind: "first",
    });
  });

  it("reports a real move with both numbers", () => {
    const move = scoreMovement(
      { score: 70, promptVersion: current },
      { score: 62, promptVersion: current },
    );
    expect(move).toEqual({ kind: "moved", delta: 8, from: 62, to: 70 });
    expect(describeMovement(move)).toContain("Up 8");
  });

  it("reports a fall plainly rather than hiding it", () => {
    // Honesty in both directions is the point of the whole app.
    const move = scoreMovement(
      { score: 55, promptVersion: current },
      { score: 62, promptVersion: current },
    );
    expect(describeMovement(move)).toContain("Down 7");
  });

  it("treats a one-point difference as no movement", () => {
    // Rounding noise on a 0-100 judgement. Presenting it as progress invites a
    // student to read meaning into nothing.
    for (const score of [61, 62, 63]) {
      const move = scoreMovement(
        { score, promptVersion: current },
        { score: 62, promptVersion: current },
      );
      expect(move.kind).toBe("held");
    }
  });

  it("REFUSES to subtract across a redefinition", () => {
    // The critical case. v9 redefined gradeRelativeScore, so a v9 number and a
    // current one measure different things — the difference between them is not
    // a change in the student, and printing it would invent a result.
    const move = scoreMovement(
      { score: 70, promptVersion: current },
      { score: 40, promptVersion: v("evaluation/v8") },
      "gradeRelativeScore",
    );
    expect(move.kind).toBe("rescaled");
    expect(describeMovement(move)).toMatch(/not comparable/i);
  });

  it("still compares a score that redefinition did NOT touch", () => {
    // Releasing every anchor because one changed is its own bug: v9 changed
    // gradeRelativeScore only, so overallScore stayed comparable across it.
    const move = scoreMovement(
      { score: 70, promptVersion: current },
      { score: 62, promptVersion: v("evaluation/v8") },
      "overallScore",
    );
    expect(move.kind).toBe("moved");
  });

  it("treats an unknown previous version as not comparable", () => {
    const move = scoreMovement(
      { score: 70, promptVersion: current },
      { score: 62, promptVersion: "something-nobody-recognises" },
    );
    expect(move.kind).toBe("rescaled");
  });

  it("says nothing about movement when a score is missing", () => {
    expect(
      scoreMovement(
        { score: null, promptVersion: current },
        { score: 62, promptVersion: current },
      ).kind,
    ).toBe("first");
  });
});

describe("whether the newest evaluation still describes the profile", () => {
  const day = 24 * 60 * 60 * 1000;
  const ran = new Date("2026-08-10T12:00:00Z");

  it("is stale once the profile has been edited since", () => {
    expect(isEvaluationStale(ran, new Date(ran.getTime() + day))).toBe(true);
  });

  it("is current when nothing has changed since", () => {
    expect(isEvaluationStale(ran, new Date(ran.getTime() - day))).toBe(false);
  });

  it("claims nothing when either timestamp is missing", () => {
    expect(isEvaluationStale(null, new Date())).toBe(false);
    expect(isEvaluationStale(ran, null)).toBe(false);
  });
});
