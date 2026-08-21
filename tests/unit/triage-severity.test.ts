// Severity is about TIME REMAINING, never about how good the student is.
//
// Two properties are load-bearing and both are easy to lose to a refactor that
// "simplifies" this into a lookup table:
//
//   IT IS GRADE-AWARE. The same unmet prerequisite is a plan for a 9th grader
//   and a crisis for a 12th. A constant per kind would rank a freshman's
//   missing Chemistry above a senior's, and a counselor who saw that once would
//   stop trusting the ordering — which is the only thing this product sells.
//
//   IT IS NOT A QUALITY MEASURE. Nothing here may read a readiness score, a
//   band or a percentile. Ranking a counselor's own students by promise is
//   professionally toxic and useless: the strongest student may need the most
//   attention.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  severityFor,
  staleThresholdDays,
  urgencyFromGrade,
} from "@/lib/counselor/triage/severity";
import {
  SEVERITY_MAX,
  SEVERITY_MIN,
  TRIAGE_KINDS,
} from "@/lib/validation/counselor";

describe("the same problem is more urgent with less time to fix it", () => {
  it("an unmet prerequisite is strictly worse for a senior than a freshman", () => {
    // The test the brief names. Strictly greater, not merely different.
    const freshman = severityFor({
      kind: "THRESHOLD_NEWLY_BINDING",
      gradeLevel: 9,
      magnitude: { unreachable: false, count: 1 },
    });
    const senior = severityFor({
      kind: "THRESHOLD_NEWLY_BINDING",
      gradeLevel: 12,
      magnitude: { unreachable: true, count: 1 },
    });
    expect(senior).toBeGreaterThan(freshman);
  });

  it("rises monotonically across every grade, for every kind", () => {
    // Swept across magnitudes as well as grades. A single hand-picked pair
    // would let a kind that ignores grade pass, and — as the first version of
    // this test found — a kind that is grade-aware in its arithmetic but so
    // damped that rounding flattens it is not grade-aware in its OUTPUT, which
    // is the only place it matters.
    const magnitudes = [
      { days: 10, months: 15, daysUntil: 80, count: 1 },
      { days: 40, months: 18, daysUntil: 30, count: 2 },
      { days: 200, months: 30, daysUntil: 3, count: 4 },
    ];

    for (const kind of TRIAGE_KINDS) {
      let movedSomewhere = false;

      for (const magnitude of magnitudes) {
        const byGrade = [9, 10, 11, 12].map((g) =>
          severityFor({ kind, gradeLevel: g, magnitude }),
        );
        for (let i = 1; i < byGrade.length; i += 1) {
          expect(
            byGrade[i]!,
            `${kind} fell from grade ${8 + i} to ${9 + i}: ${byGrade.join(", ")}`,
          ).toBeGreaterThanOrEqual(byGrade[i - 1]!);
        }
        if (byGrade[3]! > byGrade[0]!) movedSomewhere = true;
      }

      expect(
        movedSomewhere,
        `${kind} returns the same severity for a 9th and a 12th grader at every magnitude tried — it is a constant wearing a function's clothes.`,
      ).toBe(true);
    }
  });

  it("treats an unknown grade as the middle, not as urgent or relaxed", () => {
    // Flooding the list with students whose grade nobody filled in is as bad as
    // hiding a senior whose profile is merely incomplete.
    const unknown = urgencyFromGrade(null);
    expect(unknown).toBeGreaterThan(urgencyFromGrade(9));
    expect(unknown).toBeLessThan(urgencyFromGrade(12));
  });
});

describe("the scale stays inside what the schema and UI assume", () => {
  it("never leaves 1-5, for any input", () => {
    const extremes = [
      { days: 0 }, { days: 10_000 },
      { months: 0 }, { months: 500 },
      { daysUntil: 0 }, { daysUntil: 10_000 },
      { count: 0 }, { count: 999 },
      { unreachable: true }, { unreachable: false },
    ];
    for (const kind of TRIAGE_KINDS) {
      for (const grade of [null, 8, 9, 10, 11, 12, 13]) {
        for (const magnitude of extremes) {
          const s = severityFor({ kind, gradeLevel: grade, magnitude });
          expect(s, `${kind}/${grade}/${JSON.stringify(magnitude)}`).toBeGreaterThanOrEqual(SEVERITY_MIN);
          expect(s).toBeLessThanOrEqual(SEVERITY_MAX);
          expect(Number.isInteger(s)).toBe(true);
        }
      }
    }
  });

  it("puts a newly-binding threshold at the top for a senior", () => {
    // The brief calls this the highest default severity, and the reason is that
    // it is the one class of problem that is binary, fatal and invisible.
    const binding = severityFor({
      kind: "THRESHOLD_NEWLY_BINDING",
      gradeLevel: 12,
      magnitude: { unreachable: true },
    });
    expect(binding).toBe(SEVERITY_MAX);
  });

  it("keeps a counselor's own scheduling below a student's crisis", () => {
    // NO_RECENT_SESSION says nothing about the student. It must never crowd out
    // something actually happening to one.
    const scheduling = severityFor({
      kind: "NO_RECENT_SESSION",
      gradeLevel: 12,
      magnitude: { days: 200 },
    });
    const crisis = severityFor({
      kind: "THRESHOLD_NEWLY_BINDING",
      gradeLevel: 12,
      magnitude: { unreachable: true },
    });
    expect(scheduling).toBeLessThan(crisis);
  });
});

describe("quiet means different things at different ages", () => {
  it("gives a senior a much shorter leash than a freshman", () => {
    expect(staleThresholdDays(12)).toBeLessThan(staleThresholdDays(9));
  });

  it("does not flag a freshman quiet for a fortnight", () => {
    expect(staleThresholdDays(9)).toBeGreaterThan(14);
  });

  it("flags a senior quiet for a fortnight", () => {
    expect(staleThresholdDays(12)).toBeLessThanOrEqual(14);
  });
});

// A source-level check, because the property is about what this module may
// LOOK AT rather than what it returns for any input. A version that read a
// readiness score would pass every behavioural test above while quietly
// turning the attention list into a ranking of the counselor's own students.
describe("triage never reads a quality measure", () => {
  const FILES = [
    "lib/counselor/triage/severity.ts",
    "lib/counselor/triage/detect.ts",
    "lib/counselor/triage/run.ts",
  ];

  const FORBIDDEN = [
    "overallScore",
    "gradeRelativeScore",
    "readinessScore",
    "fitScore",
    "narrativeCoherence",
  ];

  for (const file of FILES) {
    const source = readFileSync(file, "utf8");

    it(`${file} reads no score field`, () => {
      for (const field of FORBIDDEN) {
        expect(
          source.includes(field),
          `${file} references ${field}. Triage ranks by NEED, never by quality — a caseload sorted by how good the students are is both professionally toxic and useless.`,
        ).toBe(false);
      }
    });

    it(`${file} makes no model call`, () => {
      // The margin property as much as the correctness one: monitoring a large
      // caseload has to stay free, or the pricing model breaks.
      for (const marker of ["anthropic", "messages.create", "getAnthropicClient"]) {
        expect(
          source.toLowerCase().includes(marker.toLowerCase()),
          `${file} references ${marker}. Triage is deterministic — never ask a model to scan a caseload.`,
        ).toBe(false);
      }
    });
  }
});
