// Rubric routing — the "US vs UK as a first-class concept" guarantee.
//
// The bug that motivates this file actually happened: early seed data used
// "UK" where the country list uses the ISO code "GB", and every UK target was
// silently evaluated under the *generic* rubric. Nothing crashed; the output
// was just quietly wrong. These tests pin the routing down.
import { describe, expect, it } from "vitest";
import {
  genericRubric,
  getRubric,
  getRubricById,
  hasCountryRubric,
  renderRubric,
  rubricsForCountries,
  ukRubric,
  usRubric,
} from "@/lib/rubrics";

describe("getRubric", () => {
  it("routes US to the holistic rubric", () => {
    expect(getRubric("US").id).toBe("us-holistic");
  });

  it("routes GB to the course-specific rubric", () => {
    expect(getRubric("GB").id).toBe("uk-course-specific");
  });

  it('routes the non-ISO alias "UK" to the same rubric as GB', () => {
    // The regression this file exists for.
    expect(getRubric("UK")).toBe(getRubric("GB"));
  });

  it("is case-insensitive", () => {
    expect(getRubric("us").id).toBe("us-holistic");
    expect(getRubric("gb").id).toBe("uk-course-specific");
  });

  it("falls back to the generic rubric for unknown countries", () => {
    expect(getRubric("DE").id).toBe("generic");
    expect(getRubric("XX").id).toBe("generic");
  });

  it("falls back to the generic rubric for missing input", () => {
    expect(getRubric(null).id).toBe("generic");
    expect(getRubric(undefined).id).toBe("generic");
    expect(getRubric("").id).toBe("generic");
  });
});

describe("hasCountryRubric", () => {
  it("is true only for countries with a real rubric", () => {
    expect(hasCountryRubric("US")).toBe(true);
    expect(hasCountryRubric("GB")).toBe(true);
    expect(hasCountryRubric("UK")).toBe(true);
    expect(hasCountryRubric("DE")).toBe(false);
    expect(hasCountryRubric(null)).toBe(false);
  });
});

describe("getRubricById", () => {
  // Saved evaluations store the rubric id; the country field on a stored
  // schoolFit is a display name ("United States"), not a code. Rendering a
  // saved evaluation must resolve by id, and this is the function that does it.
  it("resolves every registered rubric by its stored id", () => {
    expect(getRubricById("us-holistic")).toBe(usRubric);
    expect(getRubricById("uk-course-specific")).toBe(ukRubric);
    expect(getRubricById("generic")).toBe(genericRubric);
  });

  it("returns null for unknown or missing ids", () => {
    expect(getRubricById("nonsense")).toBeNull();
    expect(getRubricById(null)).toBeNull();
    expect(getRubricById(undefined)).toBeNull();
  });
});

describe("rubricsForCountries", () => {
  it("dedupes: GB and UK targets need the rubric once", () => {
    const rubrics = rubricsForCountries(["GB", "UK", "GB"]);
    expect(rubrics).toHaveLength(1);
    expect(rubrics[0]!.id).toBe("uk-course-specific");
  });

  it("returns one rubric per distinct system", () => {
    const ids = rubricsForCountries(["US", "GB", "DE", "FR"]).map((r) => r.id);
    expect(ids).toEqual(["us-holistic", "uk-course-specific", "generic"]);
  });

  it("returns nothing for no targets", () => {
    expect(rubricsForCountries([])).toEqual([]);
  });
});

describe("rubric content (prompt v3 weighting fixes)", () => {
  // These pin the v3 rebalance so a future edit can't silently undo it:
  // a sustained out-of-field commitment (the user's example was climbing)
  // must carry real weight for US holistic review...
  it("US rubric weighs sustained commitment high, not as filler", () => {
    const dim = usRubric.dimensions.find(
      (d) => d.key === "sustained_commitment",
    );
    expect(dim).toBeDefined();
    expect(dim!.weight).toBe("high");
  });

  it("US rubric weighs breadth/distinctiveness high", () => {
    const weights = Object.fromEntries(
      usRubric.dimensions.map((d) => [d.key, d.weight]),
    );
    // Personal qualities exist as a dimension at all — holistic means holistic.
    expect(usRubric.dimensions.some((d) => d.key === "personal_qualities")).toBe(
      true,
    );
    expect(Object.values(weights)).toContain("critical");
  });

  // ...while for a UK course application the same item genuinely counts for
  // little, and the rubric must say so — that asymmetry is the whole point.
  it("UK rubric keeps unrelated extracurriculars at low weight", () => {
    const dim = ukRubric.dimensions.find(
      (d) => d.key === "unrelated_extracurricular",
    );
    expect(dim).toBeDefined();
    expect(dim!.weight).toBe("low");
  });
});

describe("renderRubric", () => {
  it("renders id, every dimension with its weight, guidance and cautions", () => {
    const text = renderRubric(usRubric);
    expect(text).toContain(`id: ${usRubric.id}`);
    for (const d of usRubric.dimensions) {
      expect(text).toContain(d.label);
      expect(text).toContain(`[weight: ${d.weight}]`);
    }
    // The "do not assert admissions facts" cautions must survive rendering —
    // they are part of the no-invented-statistics guarantee.
    expect(text).toContain("Do NOT assert");
    for (const c of usRubric.cautions) {
      expect(text).toContain(c);
    }
  });
});
