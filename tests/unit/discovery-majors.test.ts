// Normalizing free-text subjects into cohort categories.
//
// This is load-bearing for k-anonymity in a way that is easy to miss. If
// "pre-med" and "Medicine" land in different categories, one cohort of twelve
// becomes two of six — both below the floor, so BOTH return nothing and the
// feature looks broken rather than protective. And if a subject lands in the
// WRONG category, a student is counted among people they have nothing to do
// with, which misinforms them and pollutes a group they are not part of.
import { describe, expect, it } from "vitest";
import {
  MAJOR_CATEGORIES,
  MAJOR_CATEGORY_GROUP,
  MAJOR_CATEGORY_LABELS,
  categoriesInGroup,
  categorizeMajor,
  groupForMajor,
} from "@/lib/discovery/majors";

describe("categorizing a subject", () => {
  it("puts the many ways of writing medicine in one place", () => {
    // The exact failure this exists to stop: these are the same cohort.
    for (const text of [
      "Medicine",
      "medicine",
      "pre-med",
      "Pre-Med",
      "premed",
      "pre med",
      "MBBS",
      "I want to be a doctor",
      "Medical school",
    ]) {
      expect(categorizeMajor(text)).toBe("medicine");
    }
  });

  it("keeps engineering subjects out of the science they are named after", () => {
    // The longest-match rule earning its keep: a shorter, looser synonym must
    // not capture a longer, more specific phrase.
    expect(categorizeMajor("Biomedical Engineering")).toBe("engineering");
    expect(categorizeMajor("Chemical Engineering")).toBe("engineering");
    expect(categorizeMajor("Mechanical Engineering")).toBe("engineering");
    // ...while the science itself still lands in the science.
    expect(categorizeMajor("Chemistry")).toBe("chemistry");
    expect(categorizeMajor("Biomedical Science")).toBe("biology_life_sciences");
  });

  it("returns null rather than guessing at something unrecognised", () => {
    // The safe failure. Absent from an aggregate costs a student nothing;
    // counted in the wrong one costs them a wrong answer.
    for (const text of ["", "   ", "not sure yet", "undecided", "???"]) {
      expect(categorizeMajor(text)).toBeNull();
    }
    expect(categorizeMajor(null)).toBeNull();
    expect(categorizeMajor(undefined)).toBeNull();
  });

  it("does not match a synonym inside an unrelated word", () => {
    // "law" inside "flawless", "art" inside "martial arts", "md" inside
    // "commodity" — whole-word matching or these become silent miscategories.
    expect(categorizeMajor("flawless")).toBeNull();
    expect(categorizeMajor("commodity trading")).toBeNull();
  });

  it("is deterministic, because a cohort that shifted between queries is probeable", () => {
    const inputs = ["Medicine", "computer science", "PPE", "Fine Art"];
    for (const text of inputs) {
      const first = categorizeMajor(text);
      for (let i = 0; i < 20; i++) expect(categorizeMajor(text)).toBe(first);
    }
  });

  it("handles the subjects this app's rubrics actually see", () => {
    expect(categorizeMajor("Computer Science")).toBe("computer_science");
    expect(categorizeMajor("Law")).toBe("law");
    expect(categorizeMajor("PPE")).toBe("economics");
    expect(categorizeMajor("English Literature")).toBe("languages_literature");
    expect(categorizeMajor("Veterinary Medicine")).toBe("nursing_allied_health");
  });
});

describe("rolling up into groups", () => {
  it("gives every category a group", () => {
    // Ladder rung 3 widens to the group, so a category without one would be a
    // student who can never widen past their exact subject.
    for (const category of MAJOR_CATEGORIES) {
      expect(MAJOR_CATEGORY_GROUP[category]).toBeTruthy();
      expect(groupForMajor(category)).toBe(MAJOR_CATEGORY_GROUP[category]);
    }
  });

  it("labels every category", () => {
    for (const category of MAJOR_CATEGORIES) {
      expect(MAJOR_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it("round-trips a category through its group", () => {
    for (const category of MAJOR_CATEGORIES) {
      const group = groupForMajor(category)!;
      expect(categoriesInGroup(group)).toContain(category);
    }
  });

  it("puts medicine and biology in different groups but keeps both reachable", () => {
    // Health and STEM are separate because a pre-med and a physicist share
    // very little — but widening must still be possible for each.
    expect(groupForMajor("medicine")).toBe("health");
    expect(groupForMajor("physics_astronomy")).toBe("stem");
    expect(categoriesInGroup("health").length).toBeGreaterThan(1);
    expect(categoriesInGroup("stem").length).toBeGreaterThan(1);
  });

  it("has no group with only one category, which would make widening a no-op", () => {
    const groups = new Set(MAJOR_CATEGORIES.map((c) => MAJOR_CATEGORY_GROUP[c]));
    for (const group of groups) {
      expect(categoriesInGroup(group).length).toBeGreaterThan(1);
    }
  });

  it("returns null for a missing category rather than throwing", () => {
    expect(groupForMajor(null)).toBeNull();
    expect(groupForMajor(undefined)).toBeNull();
  });
});
