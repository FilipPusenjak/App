// Target derivation: what score this student needs, and who is asking for it.
//
// The three policy rules are the ones worth testing hardest, because getting
// any of them wrong makes the derivation wrong for a large fraction of real US
// lists — and wrong in the direction that keeps a family paying for points that
// buy nothing.
import { describe, expect, it } from "vitest";
import {
  deriveTarget,
  optionalStrengthens,
  schoolBar,
  targetStatus,
  type PolicySchool,
} from "@/lib/testprep/target";
import {
  bestSectionScores,
  compositeAsSchoolSeesIt,
  computeComposite,
} from "@/lib/testprep/composite";
import type { TestSectionSchema } from "@/lib/validation/testprep";

/** The SAT: two sections, summed, 400–1600. */
const SAT: TestSectionSchema = {
  sections: [
    { name: "Reading and Writing", min: 200, max: 800, step: 10 },
    { name: "Math", min: 200, max: 800, step: 10 },
  ],
  compositeMin: 400,
  compositeMax: 1600,
};

/** The ACT: four sections, averaged, 1–36. */
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

describe("composites are computed, never recalled", () => {
  it("sums the SAT and averages the ACT", () => {
    expect(
      computeComposite({ "Reading and Writing": 700, Math: 750 }, "SUM", SAT),
    ).toBe(1450);
    // 34+24+30+30 = 118 / 4 = 29.5, rounded half-up to 30 as the ACT does.
    expect(
      computeComposite(
        { English: 34, Math: 24, Reading: 30, Science: 30 },
        "AVERAGE",
        ACT,
      ),
    ).toBe(30);
  });

  it("returns null rather than treating a missing section as zero", () => {
    // The failure this guards: a partial sitting reported as a catastrophic
    // composite, on a document a parent reads.
    expect(computeComposite({ "Reading and Writing": 700 }, "SUM", SAT)).toBeNull();
  });

  it("has no composite at all when the rule says NONE", () => {
    expect(computeComposite({ Essay: 5 }, "NONE", SAT)).toBeNull();
  });
});

describe("superscoring is best SECTIONS, not the best sitting", () => {
  const attempts = [
    { sectionScores: { "Reading and Writing": 700, Math: 600 }, composite: 1300 },
    { sectionScores: { "Reading and Writing": 620, Math: 760 }, composite: 1380 },
  ];

  it("composes the best section from each sitting", () => {
    // The easy bug: reporting 1380 (the best single sitting) as the superscore.
    expect(bestSectionScores(attempts, SAT)).toEqual({
      "Reading and Writing": 700,
      Math: 760,
    });
    expect(compositeAsSchoolSeesIt(attempts, "SUM", SAT, true)).toBe(1460);
  });

  it("shows a non-superscoring school only the best single sitting", () => {
    // Handing it 1460 would overstate what it will actually see — on a
    // parent-facing artifact, the worst possible place to overstate.
    expect(compositeAsSchoolSeesIt(attempts, "SUM", SAT, false)).toBe(1380);
  });
});

describe("test-blind schools are excluded entirely", () => {
  it("cannot set a bar, however high its quartiles", () => {
    const blind = school({
      schoolId: "blind",
      policy: "BLIND",
      p25: 1500,
      p50: 1550,
      p75: 1580,
    });
    expect(schoolBar(blind)).toBeNull();
  });

  it("does not bind the target even when it is the most selective on the list", () => {
    const target = deriveTarget({
      schools: [
        school({ schoolId: "required", p25: 1300, p50: 1350, p75: 1400 }),
        school({
          schoolId: "blind",
          policy: "BLIND",
          p25: 1520,
          p50: 1560,
          p75: 1590,
        }),
      ],
      attempts: [{ sectionScores: { "Reading and Writing": 700, Math: 700 }, composite: 1400 }],
      rule: "SUM",
      schema: SAT,
    });

    // 1350, not 1560 — a school that will not look at a score cannot ask for one.
    expect(target.bindingComposite).toBe(1350);
    expect(target.bindingSchoolId).toBe("required");
    expect(target.excludedBlindSchoolIds).toEqual(["blind"]);
  });

  it("names the exclusion so the student can see why", () => {
    const target = deriveTarget({
      schools: [school({ schoolId: "blind", policy: "BLIND", p50: 1560 })],
      attempts: [],
      rule: "SUM",
      schema: SAT,
    });
    const blind = target.contributions.find((c) => c.schoolId === "blind")!;
    expect(blind.contributes).toBe(false);
    expect(blind.reason).toMatch(/does not look at scores/i);
  });
});

describe("test-optional schools bind only where a score would help", () => {
  const optional = school({
    schoolId: "optional",
    policy: "OPTIONAL",
    p25: 1400,
    p50: 1480,
    p75: 1540,
  });

  it("does not raise the target when the score is below the middle 50%", () => {
    // The whole point of test-optional: a score under the middle is better not
    // sent, so it is not a bar the student has to clear.
    expect(optionalStrengthens(optional, 1350)).toBe(false);
  });

  it("binds once the score is at or above the middle 50%", () => {
    expect(optionalStrengthens(optional, 1480)).toBe(true);
    expect(optionalStrengthens(optional, 1500)).toBe(true);
  });

  it("does not bind when the student has not sat the test at all", () => {
    expect(optionalStrengthens(optional, null)).toBe(false);
  });

  it("does not raise the binding target for a student below its middle", () => {
    const target = deriveTarget({
      schools: [
        school({ schoolId: "required", p50: 1300 }),
        optional,
      ],
      attempts: [{ sectionScores: { "Reading and Writing": 650, Math: 650 }, composite: 1300 }],
      rule: "SUM",
      schema: SAT,
    });

    expect(target.bindingComposite).toBe(1300);
    expect(target.bindingSchoolId).toBe("required");
    expect(target.nonBindingOptionalSchoolIds).toEqual(["optional"]);
  });

  it("does raise it once the student clears its middle", () => {
    const target = deriveTarget({
      schools: [school({ schoolId: "required", p50: 1300 }), optional],
      attempts: [{ sectionScores: { "Reading and Writing": 750, Math: 750 }, composite: 1500 }],
      rule: "SUM",
      schema: SAT,
    });

    expect(target.bindingComposite).toBe(1480);
    expect(target.bindingSchoolId).toBe("optional");
    expect(target.nonBindingOptionalSchoolIds).toEqual([]);
  });
});

describe("the naming school", () => {
  it("is reported alongside the number, because the number alone is unactionable", () => {
    const target = deriveTarget({
      schools: [
        school({ schoolId: "a", schoolName: "State", p50: 1200 }),
        school({ schoolId: "b", schoolName: "Duke", p25: 1450, p50: 1500, p75: 1560 }),
      ],
      attempts: [],
      rule: "SUM",
      schema: SAT,
    });

    expect(target.bindingComposite).toBe(1500);
    expect(target.bindingSchoolName).toBe("Duke");
    // The band comes from the naming school's own spread, not from a guess.
    expect([target.bandLow, target.bandHigh]).toEqual([1450, 1560]);
  });

  it("is stable across recomputation when two schools tie", () => {
    // A flickering naming school would make the tutor's screen change for no
    // reason a student could understand.
    const schools = [
      school({ schoolId: "zzz", p50: 1400 }),
      school({ schoolId: "aaa", p50: 1400 }),
    ];
    const first = deriveTarget({ schools, attempts: [], rule: "SUM", schema: SAT });
    const second = deriveTarget({
      schools: [...schools].reverse(),
      attempts: [],
      rule: "SUM",
      schema: SAT,
    });
    expect(first.bindingSchoolId).toBe(second.bindingSchoolId);
  });
});

describe("a list that sets no bar at all", () => {
  it("reports no target rather than inventing one", () => {
    // Every school blind, or none publishing quartiles. A real answer.
    const target = deriveTarget({
      schools: [
        school({ schoolId: "blind", policy: "BLIND", p50: 1500 }),
        school({ schoolId: "unpublished" }),
      ],
      attempts: [],
      rule: "SUM",
      schema: SAT,
    });
    expect(target.bindingComposite).toBeNull();
    expect(target.bindingSchoolId).toBeNull();
    expect(target.bandLow).toBeNull();
  });
});

describe("status against the band", () => {
  const target = deriveTarget({
    schools: [school({ schoolId: "a", p25: 1400, p50: 1450, p75: 1500 })],
    attempts: [],
    rule: "SUM",
    schema: SAT,
  });

  it("reads a gap, in-band and cleared apart", () => {
    expect(targetStatus(1300, target)).toBe("GAP_REMAINS");
    expect(targetStatus(1450, target)).toBe("IN_BAND");
    expect(targetStatus(1500, target)).toBe("CLEARED");
    expect(targetStatus(1590, target)).toBe("CLEARED");
  });

  it("does not claim progress for a student with no score yet", () => {
    expect(targetStatus(null, target)).toBe("GAP_REMAINS");
  });
});
