// The widening ladder.
//
// Two things can go wrong here and only one of them is visible. Resolving in
// the wrong order gives a worse answer than necessary — annoying, findable.
// Reporting the wrong scope tells a student that a national baseline is what
// their classmates are doing, which is a false claim about their own school
// dressed up as local knowledge. These tests are mostly about the second.
import { describe, expect, it } from "vitest";
import {
  SCOPE_CAVEATS,
  SCOPE_LABELS,
  SCOPE_LADDER,
  isOwnSchoolScope,
  resolveScope,
  type DiscoveryScope,
} from "@/lib/discovery/scope";
import { isReportableCohort, MIN_COHORT_SIZE } from "@/lib/discovery/policy";

/** Sizes for each scope, defaulting to "empty". */
function sizes(overrides: Partial<Record<DiscoveryScope, number>>) {
  const calls: DiscoveryScope[] = [];
  const sizeOf = async (scope: DiscoveryScope) => {
    calls.push(scope);
    return overrides[scope] ?? 0;
  };
  return { sizeOf, calls };
}

describe("resolving a scope", () => {
  it("takes the narrowest scope that clears the threshold", async () => {
    const { sizeOf } = sizes({
      SCHOOL_MAJOR_YEAR: MIN_COHORT_SIZE,
      SCHOOL_MAJOR: 500,
      NATIONAL_MAJOR: 90_000,
    });
    const resolved = await resolveScope(sizeOf, isReportableCohort);
    expect(resolved?.scope).toBe("SCHOOL_MAJOR_YEAR");
  });

  it("widens past scopes that are too small, in ladder order", async () => {
    const { sizeOf, calls } = sizes({
      SCHOOL_MAJOR_YEAR: 2,
      SCHOOL_MAJOR: 6,
      SCHOOL_MAJOR_GROUP: MIN_COHORT_SIZE,
    });
    const resolved = await resolveScope(sizeOf, isReportableCohort);
    expect(resolved?.scope).toBe("SCHOOL_MAJOR_GROUP");
    expect(calls).toEqual([
      "SCHOOL_MAJOR_YEAR",
      "SCHOOL_MAJOR",
      "SCHOOL_MAJOR_GROUP",
    ]);
  });

  it("stops counting as soon as a scope resolves", async () => {
    // Not just an efficiency point: every scope evaluated is another aggregate
    // computed over children's records for no reason.
    const { sizeOf, calls } = sizes({ SCHOOL_MAJOR_YEAR: 40 });
    await resolveScope(sizeOf, isReportableCohort);
    expect(calls).toEqual(["SCHOOL_MAJOR_YEAR"]);
  });

  it("returns null when nothing resolves, rather than the largest scope", async () => {
    // The empty state. There is no smaller amount of data that would be safe
    // to show instead, so "nothing" is the answer, not a fallback.
    const { sizeOf } = sizes({
      SCHOOL_MAJOR_YEAR: 1,
      SCHOOL_MAJOR: 2,
      SCHOOL_MAJOR_GROUP: 3,
      REGION_SIMILAR_SCHOOLS_MAJOR: 4,
      NATIONAL_MAJOR: MIN_COHORT_SIZE - 1,
    });
    expect(await resolveScope(sizeOf, isReportableCohort)).toBeNull();
  });

  it("never resolves to a scope below the threshold, whatever the sizes", async () => {
    // Swept rather than sampled: the one thing that must hold for every shape
    // of input is that a returned scope was genuinely big enough.
    for (let i = 0; i < 200; i++) {
      const overrides = Object.fromEntries(
        SCOPE_LADDER.map((s) => [s, Math.floor(Math.random() * 25)]),
      ) as Partial<Record<DiscoveryScope, number>>;
      const { sizeOf } = sizes(overrides);
      const resolved = await resolveScope(sizeOf, isReportableCohort);
      if (resolved) {
        expect(resolved.distinctStudents).toBeGreaterThanOrEqual(MIN_COHORT_SIZE);
        expect(overrides[resolved.scope]).toBe(resolved.distinctStudents);
      }
    }
  });
});

describe("what the student is told about the scope", () => {
  it("labels every scope on the ladder", () => {
    for (const scope of SCOPE_LADDER) {
      expect(SCOPE_LABELS[scope]).toBeTruthy();
      expect(SCOPE_LABELS[scope].length).toBeGreaterThan(10);
    }
  });

  it("caveats every scope that is not the student's own school", () => {
    // The honesty requirement: a wider scope must never read as "your school".
    for (const scope of SCOPE_LADDER) {
      if (!isOwnSchoolScope(scope)) {
        expect(SCOPE_CAVEATS[scope]).toBeTruthy();
      }
    }
  });

  it("does not claim 'your school' in the label of a scope that isn't", () => {
    for (const scope of SCOPE_LADDER) {
      if (isOwnSchoolScope(scope)) continue;
      expect(SCOPE_LABELS[scope]).not.toMatch(/\byour school\b/i);
    }
  });

  it("orders the ladder narrowest first", () => {
    // Own-school scopes must all precede the wider ones; otherwise a student
    // could be shown a national aggregate while a school-level one existed.
    const lastOwnSchool = SCOPE_LADDER.map(isOwnSchoolScope).lastIndexOf(true);
    const firstWider = SCOPE_LADDER.map(isOwnSchoolScope).indexOf(false);
    expect(lastOwnSchool).toBeLessThan(firstWider);
  });
});
