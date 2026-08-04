// The EU rubric, and the reason it is a bloc rubric rather than an Irish one.
//
// Trinity College Dublin was falling through to the cautious generic fallback,
// which assesses almost nothing and tells the student to go and find out. But
// Ireland is not special enough to deserve a rubric while the Netherlands,
// Germany, France and the Nordics fall through the same hole. What they share
// is a SHAPE — a recognised leaving qualification, grades in the required
// subjects, and the language of instruction — that differs from both US
// holistic review and UK course-specific selection.
//
// The risk in a bloc rubric is the one this whole app exists to avoid:
// flattening genuinely different systems into one. Ireland's points total,
// Germany's grade thresholds and Dutch selection differ from each other far
// more than they resemble each other, so most of what is tested here is that
// the rubric says so.
import { describe, expect, it } from "vitest";
import {
  euRubric,
  genericRubric,
  getRubric,
  getRubricById,
  hasCountryRubric,
  renderRubric,
  rubricsForCountries,
  ukRubric,
  usRubric,
  EU_COUNTRIES,
} from "@/lib/rubrics";

describe("which countries it covers", () => {
  it("covers the EU members a student actually applies to", () => {
    for (const code of ["IE", "DE", "NL", "FR", "ES", "IT", "SE", "DK", "PL", "PT"]) {
      expect(getRubric(code).id).toBe("eu-qualification-led");
    }
  });

  it("covers the EEA and Switzerland, which admit the same way", () => {
    // Not members, same shape. The mapping is by admissions system, not by
    // political membership.
    for (const code of ["NO", "IS", "CH", "LI"]) {
      expect(getRubric(code).id).toBe("eu-qualification-led");
    }
  });

  it("leaves the UK on its own rubric", () => {
    // The UK left more than the union: a personal-statement-led,
    // super-curricular admission is not a qualification-led one.
    expect(getRubric("GB").id).toBe("uk-course-specific");
    expect(getRubric("UK").id).toBe("uk-course-specific");
    expect(EU_COUNTRIES as readonly string[]).not.toContain("GB");
  });

  it("still falls back to generic outside Europe", () => {
    expect(getRubric("JP").id).toBe("generic");
    expect(getRubric("AU").id).toBe("generic");
    expect(hasCountryRubric("JP")).toBe(false);
  });

  it("is case-insensitive, like the rest of the registry", () => {
    expect(getRubric("de").id).toBe("eu-qualification-led");
  });

  it("collapses a multi-country European list into ONE rubric", () => {
    // The saving that makes a bloc rubric worth having: a student targeting
    // three European countries gets one rubric, not three near-identical ones.
    const ids = rubricsForCountries(["IE", "NL", "DE", "FR"]).map((r) => r.id);
    expect(ids).toEqual(["eu-qualification-led"]);
  });

  it("is resolvable by id, so stored evaluations still render", () => {
    expect(getRubricById("eu-qualification-led")).toBe(euRubric);
  });
});

describe("it refuses to pretend Europe is one system", () => {
  const text = renderRubric(euRubric);

  it("says so in the strongest terms available", () => {
    expect(text).toMatch(/"THE EU" IS NOT ONE ADMISSIONS SYSTEM/);
    expect(text).toMatch(/TREATING IT AS ONE IS THE MAIN RISK/);
  });

  it("names how the countries actually differ", () => {
    expect(text).toMatch(/Ireland admits on a points total/);
    expect(text).toMatch(/Germany on school-leaving grade thresholds/);
    expect(text).toMatch(/Netherlands by selection for capped programmes/);
    expect(text).toMatch(/grandes écoles running an entirely separate competitive route/);
  });

  it("says what they DO share, which is what the rubric applies", () => {
    expect(text).toMatch(
      /admission is led by qualifications, grades and language rather than by a rounded personal profile/,
    );
  });
});

describe("what it weighs, and what it refuses to weigh", () => {
  const text = renderRubric(euRubric);

  it("puts the qualification, required subjects and language at the top", () => {
    const critical = euRubric.dimensions
      .filter((d) => d.weight === "critical")
      .map((d) => d.key);
    expect(critical).toEqual([
      "leaving_qualification",
      "required_subject_grades",
      "language_of_instruction",
    ]);
  });

  it("weighs the REQUIRED subjects above the overall average", () => {
    expect(text).toMatch(/WEIGH THE REQUIRED SUBJECTS ABOVE THE OVERALL AVERAGE/);
    expect(text).toMatch(/95 average with a weak mathematics grade is a serious problem/);
  });

  it("treats language as a hard gate rather than a footnote", () => {
    expect(text).toMatch(/LANGUAGE IS A HARD GATE AND IS ROUTINELY UNDERESTIMATED/);
    expect(text).toMatch(/dated obstacle with a concrete plan/);
  });

  it("rates extracurricular breadth LOW — the big difference from the US", () => {
    const breadth = euRubric.dimensions.find((d) => d.key === "extracurricular_breadth")!;
    expect(breadth.weight).toBe("low");
  });

  it("blames the SYSTEM for that, not the activity", () => {
    // The same distinction the UK rubric draws. An item can be a real asset for
    // a US target and count for nothing here, and both are true at once.
    expect(text).toMatch(/THE SYSTEM DOES NOT READ IT — not that the item is weak/);
    expect(text).toMatch(/valuable there, not here/);
  });

  it("does not import UK reasoning either", () => {
    expect(text).toMatch(/Do not import UK reasoning/);
    expect(text).toMatch(/no equivalent document and no place to argue anything/);
  });
});

describe("threshold, not contest", () => {
  const text = renderRubric(euRubric);

  it("says most courses admit rather than select", () => {
    expect(text).toMatch(/Admission is usually a THRESHOLD, not a contest/);
    expect(text).toMatch(/there is no pool to be ranked against/);
  });

  it("forbids inventing a competition that does not exist", () => {
    expect(text).toMatch(/Do not describe an ordinary programme as competitive/);
    expect(text).toMatch(/do not tell a qualified student to strengthen a profile that will not be read/);
  });

  it("still handles restricted-entry courses, where the cap decides", () => {
    expect(text).toMatch(/restricted-entry courses, where the cap makes the mechanism decisive/);
    expect(text).toMatch(/entrance examination, an aptitude test, a weighted procedure, or in some places a partial lottery/);
  });
});

describe("the stage ladder fits a qualification-led system", () => {
  it("has the same three stages as every other rubric", () => {
    expect(euRubric.stages.map((s) => s.key)).toEqual(["early", "middle", "final"]);
  });

  it("makes the early years about subjects and language, not achievements", () => {
    const early = euRubric.stages.find((s) => s.key === "early")!;
    const evidence = early.evidence.join(" ");
    expect(evidence).toMatch(/subjects their intended course is likely to require/);
    expect(evidence).toMatch(/Starting the language of instruction early/);
    expect(early.purpose).toMatch(/it needs to be correct/);
  });

  it("gates the things a young student genuinely cannot have", () => {
    const early = euRubric.stages.find((s) => s.key === "early")!;
    const gated = early.notYetExpected.join(" ").toLowerCase();
    expect(gated).toMatch(/final or predicted grades/);
    expect(gated).toMatch(/entrance examinations/);
    expect(gated).toMatch(/language certificate/);
  });

  it("says starting extracurriculars in the final year changes nothing here", () => {
    const final = euRubric.stages.find((s) => s.key === "final")!;
    expect(final.notYetExpected.join(" ")).toMatch(
      /would not affect a qualification-led decision/,
    );
  });
});

describe("it invents no numbers", () => {
  const text = renderRubric(euRubric);

  it("refuses grade thresholds, points totals and conversions", () => {
    expect(text).toMatch(
      /Do not state any specific grade requirement, points total, numerus clausus or numerus fixus threshold, or grade-point conversion/,
    );
  });

  it("refuses to assert which courses are capped in a given year", () => {
    expect(text).toMatch(/Do not assert which courses are capped or restricted-entry/);
  });

  it("refuses language thresholds and fee status", () => {
    expect(text).toMatch(/Do not state language certificate thresholds/);
    expect(text).toMatch(/Do not state tuition fees/);
    expect(text).toMatch(/domestic, EU or international fee status/);
  });

  it("does not assume a course is taught in English", () => {
    expect(text).toMatch(/Do not assume a course is taught in English/);
  });

  it("keeps the selectivity carve-out consistent with the other rubrics", () => {
    // Every rubric has to agree with the system prompt here, or the model
    // follows one of them at random.
    expect(text).toMatch(/Saying in words how selective a course is/);
    expect(text).toMatch(/not the same thing and is not covered by this/);
  });
});

describe("it is a real rubric, not a reworded fallback", () => {
  it("says more than the generic one it replaces for these countries", () => {
    expect(renderRubric(euRubric).length).toBeGreaterThan(
      renderRubric(genericRubric).length * 2,
    );
  });

  it("is structurally complete, like the US and UK rubrics", () => {
    for (const rubric of [usRubric, ukRubric, euRubric]) {
      expect(rubric.dimensions.length).toBeGreaterThanOrEqual(3);
      expect(rubric.guidance.length).toBeGreaterThanOrEqual(3);
      expect(rubric.cautions.length).toBeGreaterThanOrEqual(3);
      for (const stage of rubric.stages) {
        expect(stage.purpose.length).toBeGreaterThan(40);
        expect(stage.evidence.length).toBeGreaterThan(0);
        expect(stage.notYetExpected.length).toBeGreaterThan(0);
      }
    }
  });
});
