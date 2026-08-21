// The stopping engine — the feature that defines this product.
//
// The tests that matter most are the ones proving it fires when firing costs
// the tutor money, and stays quiet when a student genuinely has something left
// to gain. A stopping engine that under-fires is a score tracker; one that
// over-fires talks students out of points they could have had.
import { describe, expect, it } from "vitest";
import { deriveTarget, type PolicySchool } from "@/lib/testprep/target";
import { allocateSections } from "@/lib/testprep/allocation";
import {
  evaluateStopping,
  handoffMessage,
  isEngagementComplete,
  standardRetakeIncrement,
} from "@/lib/testprep/stopping";
import { bestSectionScores } from "@/lib/testprep/composite";
import type { TestSectionSchema } from "@/lib/validation/testprep";
import { findBannedPredictionPhrasing } from "@/lib/validation/testprep";

const SAT: TestSectionSchema = {
  sections: [
    { name: "Reading and Writing", min: 200, max: 800, step: 10 },
    { name: "Math", min: 200, max: 800, step: 10 },
  ],
  compositeMin: 400,
  compositeMax: 1600,
};

const ACT: TestSectionSchema = {
  sections: [
    { name: "English", min: 1, max: 36, step: 1 },
    { name: "Math", min: 1, max: 36, step: 1 },
    { name: "Reading", min: 1, max: 36, step: 1 },
    { name: "Science", min: 1, max: 36, step: 1 },
  ],
  compositeMin: 1,
  compositeMax: 36,
};

function school(over: Partial<PolicySchool> & { schoolId: string }): PolicySchool {
  return {
    schoolName: `School ${over.schoolId}`,
    policy: "REQUIRED",
    superscores: false,
    scoreChoice: false,
    p25: null,
    p50: null,
    p75: null,
    effectiveCycle: 2026,
    ...over,
  };
}

/** Assemble the whole pure pipeline the way the persistence layer does. */
function run(input: {
  schools: PolicySchool[];
  attempts: { sectionScores: Record<string, number>; composite: number | null }[];
  schema?: TestSectionSchema;
  rule?: "SUM" | "AVERAGE";
}) {
  const schema = input.schema ?? SAT;
  const rule = input.rule ?? "SUM";
  const target = deriveTarget({ schools: input.schools, attempts: input.attempts, rule, schema });
  const allocations = allocateSections({
    current: bestSectionScores(input.attempts, schema),
    schema,
    rule,
  });
  const signals = evaluateStopping({
    target,
    schools: input.schools,
    attempts: input.attempts,
    allocations,
    rule,
    schema,
    retakeIncrement: standardRetakeIncrement(rule, schema),
  });
  return { target, allocations, signals, kinds: signals.map((s) => s.kind) };
}

describe("ALL_TARGETS_MET", () => {
  it("fires when the superscore clears every non-blind school on the list", () => {
    const { kinds } = run({
      schools: [
        school({ schoolId: "a", superscores: true, p25: 1350, p50: 1400, p75: 1450 }),
        school({ schoolId: "b", superscores: true, p25: 1300, p50: 1350, p75: 1400 }),
        // Blind, and far above them — must not hold the engagement open.
        school({ schoolId: "blind", policy: "BLIND", p50: 1580 }),
      ],
      attempts: [
        { sectionScores: { "Reading and Writing": 730, Math: 690 }, composite: 1420 },
        { sectionScores: { "Reading and Writing": 700, Math: 740 }, composite: 1440 },
      ],
    });

    // Superscore is 730 + 740 = 1470, clearing both bars.
    expect(kinds).toContain("ALL_TARGETS_MET");
    expect(kinds).toContain("RETAKE_NOT_INDICATED");
  });

  it("does NOT fire while one school is still unmet", () => {
    const { kinds } = run({
      schools: [
        school({ schoolId: "a", p50: 1300 }),
        school({ schoolId: "hard", p50: 1550 }),
      ],
      attempts: [{ sectionScores: { "Reading and Writing": 700, Math: 700 }, composite: 1400 }],
    });
    expect(kinds).not.toContain("ALL_TARGETS_MET");
  });

  it("stays quiet when no school on the list sets a bar", () => {
    // Firing here would tell a student to stop because we hold no data about
    // their schools — the worst possible reason to stop.
    const { kinds } = run({
      schools: [school({ schoolId: "unpublished" })],
      attempts: [{ sectionScores: { "Reading and Writing": 400, Math: 400 }, composite: 800 }],
    });
    expect(kinds).toEqual([]);
  });

  it("is an engagement-complete signal, and emits a handoff", () => {
    const { target, signals } = run({
      schools: [school({ schoolId: "a", schoolName: "Duke", p50: 1400 })],
      attempts: [{ sectionScores: { "Reading and Writing": 750, Math: 750 }, composite: 1500 }],
    });
    expect(isEngagementComplete(signals)).toBe(true);

    const handoff = handoffMessage(target);
    expect(handoff).toContain("Duke");
    expect(handoff).toMatch(/differentiation/i);
    // Information, not an upsell — and never a prediction.
    expect(findBannedPredictionPhrasing(handoff)).toEqual([]);
  });
});

describe("MARGINAL_VALUE_ZERO", () => {
  it("fires when a full standard retake gain would move no school", () => {
    // Gap of 200 points to the only school; a standard SAT increment is 60.
    const { kinds } = run({
      schools: [school({ schoolId: "reach", p50: 1600 })],
      attempts: [{ sectionScores: { "Reading and Writing": 700, Math: 700 }, composite: 1400 }],
    });
    expect(kinds).toContain("MARGINAL_VALUE_ZERO");
  });

  it("does NOT fire when a retake would actually flip a school", () => {
    // 1400 now, bar at 1450, a 60-point increment clears it. Real value left.
    const { kinds } = run({
      schools: [school({ schoolId: "close", p50: 1450 })],
      attempts: [{ sectionScores: { "Reading and Writing": 700, Math: 700 }, composite: 1400 }],
    });
    expect(kinds).not.toContain("MARGINAL_VALUE_ZERO");
    expect(kinds).toEqual([]);
  });

  it("is generous about the increment, so it only fires when it is not close", () => {
    // 5% of the scale — 60 on the SAT, 2 on the ACT. Erring high means the
    // engine stays quiet on students who genuinely had something to gain.
    expect(standardRetakeIncrement("SUM", SAT)).toBe(60);
    expect(standardRetakeIncrement("AVERAGE", ACT)).toBe(2);
  });
});

describe("SUPERSCORE_COMPLETE", () => {
  it("fires when every section is maxed, even if a bar is still unmet", () => {
    // Maxed AND short is a real state, and it is a conversation about the list
    // rather than about the studying.
    const { kinds } = run({
      schools: [school({ schoolId: "impossible", p50: 1650 })],
      attempts: [{ sectionScores: { "Reading and Writing": 800, Math: 800 }, composite: 1600 }],
    });
    expect(kinds).toContain("SUPERSCORE_COMPLETE");
  });

  it("does not fire while any section has room", () => {
    const { kinds } = run({
      schools: [school({ schoolId: "a", p50: 1500 })],
      attempts: [{ sectionScores: { "Reading and Writing": 800, Math: 700 }, composite: 1500 }],
    });
    expect(kinds).not.toContain("SUPERSCORE_COMPLETE");
  });
});

describe("DIMINISHING_RETURNS", () => {
  it("fires when every remaining point combined would not close the gap", () => {
    // 790 + 780 = 1570, bar 1600: gap 30, total headroom 10 + 20 = 30... so it
    // exactly closes. Push the bar one higher to make it genuinely impossible.
    const { kinds, signals } = run({
      schools: [school({ schoolId: "hard", schoolName: "Reach U", p50: 1601 })],
      attempts: [{ sectionScores: { "Reading and Writing": 790, Math: 780 }, composite: 1570 }],
    });
    expect(kinds).toContain("DIMINISHING_RETURNS");

    const signal = signals.find((s) => s.kind === "DIMINISHING_RETURNS")!;
    // The basis is what a tutor checks before repeating it to a family.
    expect(signal.basis).toMatchObject({
      gapToBindingSchool: 31,
      totalHeadroomRemaining: 30,
    });
    expect(signal.summary).toContain("Reach U");
  });

  it("does not fire when the room that remains could still close the gap", () => {
    const { kinds } = run({
      schools: [school({ schoolId: "a", p50: 1500 })],
      attempts: [{ sectionScores: { "Reading and Writing": 700, Math: 700 }, composite: 1400 }],
    });
    expect(kinds).not.toContain("DIMINISHING_RETURNS");
  });
});

describe("every signal carries an inspectable basis", () => {
  it("names the computed facts behind it, never a bare assertion", () => {
    const { signals } = run({
      schools: [school({ schoolId: "a", schoolName: "Duke", p25: 1350, p50: 1400, p75: 1450 })],
      attempts: [{ sectionScores: { "Reading and Writing": 750, Math: 750 }, composite: 1500 }],
    });
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      // A tutor is about to tell a parent to stop paying them. They will not do
      // that on a system's say-so.
      expect(signal.basis).toHaveProperty("signal");
      expect(Object.keys(signal.basis).length).toBeGreaterThan(1);
      expect(signal.summary.length).toBeGreaterThan(0);
    }
  });

  it("never phrases a signal as a prediction", () => {
    const { signals } = run({
      schools: [school({ schoolId: "a", p50: 1400 })],
      attempts: [{ sectionScores: { "Reading and Writing": 750, Math: 750 }, composite: 1500 }],
    });
    expect(findBannedPredictionPhrasing(signals)).toEqual([]);
  });
});

describe("the engine is pure", () => {
  it("returns the same signals for the same inputs, every time", () => {
    // No clock, no randomness, no I/O. A stopping signal that varied run to run
    // could not be acknowledged or cited.
    const args = {
      schools: [school({ schoolId: "a", p50: 1400 })],
      attempts: [
        { sectionScores: { "Reading and Writing": 750, Math: 750 }, composite: 1500 },
      ],
    };
    expect(run(args).kinds).toEqual(run(args).kinds);
  });
});
