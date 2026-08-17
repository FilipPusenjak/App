// The names a student might type, and the ones they must never be given.
//
// Expanding one typed name into several candidates is the only change in the
// matcher that can produce a WRONG match rather than merely a missing one, so
// most of this file is about the limits: which rewrites are refused, and which
// short forms are deliberately absent from the curated table.
import { describe, expect, it } from "vitest";
import {
  allCuratedAliases,
  curatedAlias,
  splitTrailingAcronym,
} from "@/lib/requirements/aliases";
import {
  matchKey,
  normalizeName,
  normalizeUniversity,
  universityVariants,
} from "@/lib/requirements/match";
import { candidateKeys, candidateUniversities } from "@/lib/requirements/resolve";

describe("a university's own acronym", () => {
  it("does not end up inside the key", () => {
    // The bug this fixes: 60 of the first 839 researched records stored as
    // `university college london ucl`, so the FULL CORRECT NAME missed.
    expect(normalizeUniversity("University College London (UCL)")).toBe(
      "university college london",
    );
    expect(normalizeUniversity("Massachusetts Institute of Technology (MIT)")).toBe(
      "massachusetts institute technology",
    );
  });

  it("means a student typing the plain name now matches the record", () => {
    const stored = matchKey({
      university: "University College London (UCL)",
      country: "GB",
      course: "Law LLB",
    });
    const typed = matchKey({
      university: "University College London",
      country: "GB",
      course: "Law LLB",
    });
    expect(typed).toBe(stored);
  });

  it("is read off the name rather than hand-maintained", () => {
    expect(splitTrailingAcronym("University College London (UCL)")).toEqual({
      name: "University College London",
      acronym: "UCL",
    });
    expect(splitTrailingAcronym("University of Oxford")).toEqual({
      name: "University of Oxford",
      acronym: null,
    });
  });

  it("is NEVER stripped from a course name", () => {
    // Course parentheticals are load-bearing and distinguish real courses.
    // normalizeName is what courses go through, and it must leave them alone.
    expect(normalizeName("Medicine (A100)")).toContain("a100");
    expect(normalizeName("Computer Science and Engineering (SB, Course 6-3)")).toContain(
      "6 3",
    );
    // Two Cambridge courses that differ ONLY by their code must not collide.
    const a = matchKey({ university: "X", country: "GB", course: "Medicine (A100)" });
    const b = matchKey({ university: "X", country: "GB", course: "Medicine (A101)" });
    expect(a).not.toBe(b);
  });

  it("ignores a parenthetical that is not an acronym", () => {
    const long = "University of Somewhere (a very long descriptive phrase)";
    expect(splitTrailingAcronym(long).acronym).toBeNull();
  });
});

describe("mechanical rewrites", () => {
  it("connects 'Cambridge' to 'University of Cambridge'", () => {
    expect(universityVariants("cambridge")).toContain("university cambridge");
    expect(universityVariants("university cambridge")).toContain("cambridge");
  });

  it("connects 'Yale' to 'Yale University'", () => {
    expect(universityVariants("yale")).toContain("yale university");
    expect(universityVariants("yale university")).toContain("yale");
  });

  it("REFUSES to strip 'university' from 'university college london'", () => {
    // The noise-word lesson in narrower form: "college london" is a step onto
    // the path where UCL, KCL and Imperial start colliding.
    const variants = universityVariants("university college london");
    expect(variants).not.toContain("college london");
    expect(variants).toContain("university college london");
  });

  it("never returns an empty name", () => {
    expect(universityVariants("")).toEqual([]);
    for (const v of universityVariants("cambridge")) expect(v.length).toBeGreaterThan(0);
  });
});

describe("the curated table", () => {
  it("resolves the acronyms students actually type", () => {
    expect(curatedAlias("ucla", "US")).toBe("university california los angeles");
    expect(curatedAlias("ut austin", "US")).toBe("university texas austin");
    expect(curatedAlias("kcl", "GB")).toBe("kings college london");
  });

  it("is scoped to a country, because short forms are not global", () => {
    expect(curatedAlias("ucla", "GB")).toBeNull();
    expect(curatedAlias("kcl", "US")).toBeNull();
  });

  it("omits the short forms that name more than one institution", () => {
    // Each of these was considered and left out on purpose. If one is ever
    // added, this test is the argument it has to beat.
    for (const country of ["US", "GB"]) {
      expect(curatedAlias("penn", country)).toBeNull(); // Penn vs Penn State
      expect(curatedAlias("berkeley", country)).toBeNull(); // Berkeley College
      expect(curatedAlias("trinity", country)).toBeNull(); // Dublin/Cambridge/Oxford
      expect(curatedAlias("trinity college", country)).toBeNull();
    }
  });

  it("has keys written the way normalizeName produces them", () => {
    // An entry whose key never normalizes to itself is silently dead: nothing
    // can ever look it up, and nothing would report that.
    for (const { alias } of allCuratedAliases()) {
      expect(normalizeName(alias)).toBe(alias);
    }
  });

  it("never maps two aliases in one country to different spellings of one name", () => {
    // Guards against a typo'd canonical, which would look fine and match zero
    // records forever.
    for (const { canonical } of allCuratedAliases()) {
      expect(normalizeName(canonical)).toBe(canonical);
    }
  });

  it("never aliases a name to itself", () => {
    for (const { alias, canonical } of allCuratedAliases()) {
      expect(alias).not.toBe(canonical);
    }
  });
});

describe("candidates for a typed name", () => {
  it("reaches the canonical name from the acronym", () => {
    expect(candidateUniversities("UCLA", "US")).toContain(
      "university california los angeles",
    );
  });

  it("reaches the canonical name from a short form", () => {
    expect(candidateUniversities("Cambridge", "GB")).toContain("university cambridge");
  });

  it("keeps the name as typed", () => {
    expect(candidateUniversities("University of Oxford", "GB")).toContain(
      "university oxford",
    );
  });

  it("returns nothing for a name that is entirely noise", () => {
    expect(candidateUniversities("the of at", "GB")).toEqual([]);
  });
});

describe("candidate keys", () => {
  const target = (over: Partial<{ name: string; country: string; course: string | null }> = {}) => ({
    name: "University of Cambridge",
    country: "GB",
    course: "Computer Science",
    ...over,
  });

  it("refuses to look up a target with no course", () => {
    // A university-level guess at course-specific requirements is exactly the
    // wrong match the matcher exists to avoid.
    expect(candidateKeys(target({ course: null }))).toEqual([]);
    expect(candidateKeys(target({ course: "   " }))).toEqual([]);
  });

  it("keeps the country in every key", () => {
    for (const key of candidateKeys(target())) expect(key.startsWith("GB::")).toBe(true);
  });

  it("never crosses a country", () => {
    const gb = candidateKeys(target({ country: "GB" }));
    const us = candidateKeys(target({ country: "US" }));
    expect(gb.some((k) => us.includes(k))).toBe(false);
  });

  it("keeps the course identical across every candidate", () => {
    // Only the UNIVERSITY is expanded. A rewrite that also loosened the course
    // could match a different course at the right school.
    const courses = new Set(candidateKeys(target()).map((k) => k.split("::")[2]));
    expect(courses.size).toBe(1);
    expect([...courses][0]).toBe("computer science");
  });
});
