// What score this student actually needs, and which school is asking for it.
//
// The centre of the tutor edition, and pure computation start to finish — zero
// model calls, here or anywhere downstream of here. A model asked to recall a
// school's 75th percentile will produce a number with total confidence and no
// source, and a tutor will repeat it to a parent.
//
// THE NAMING SCHOOL IS THE POINT. "1500" is a number a student cannot act on.
// "1500, and it is Duke that asks for it" tells them what to do about it —
// including the option nobody else in this market will mention, which is
// changing the list rather than the score. Explainability is worth more here
// than precision, which is why bindingSchool is not nullable-by-convenience.
//
// THREE THINGS DECIDE THE ARITHMETIC, and getting any of them wrong makes the
// whole derivation wrong for a large fraction of real US lists:
//
//   TEST-BLIND SCHOOLS ARE EXCLUDED ENTIRELY, not weighted down. A school that
//   will not look at a score cannot ask for one, and letting it contribute a
//   quartile would hold a student to a bar that does not exist.
//
//   TEST-OPTIONAL SCHOOLS BIND ONLY WHERE SUBMITTING WOULD HELP. The whole
//   point of test-optional is that a score below the middle of the class is
//   better not sent. Treating one as REQUIRED invents a target the student
//   could simply decline to be measured against.
//
//   SUPERSCORE POLICY DECIDES WHAT THE SCHOOL EVEN SEES. A superscoring target
//   reads the best sections combined; a non-superscoring one reads the best
//   single sitting. The same score history clears one and not the other.
import type { TestSectionSchema, TestPolicy } from "@/lib/validation/testprep";
import type { CompositeRule } from "@/lib/validation/testprep";
import {
  compositeAsSchoolSeesIt,
  type SectionScores,
} from "./composite";

/** One school on the student's list, with what it does about this test. */
export type PolicySchool = {
  schoolId: string;
  schoolName: string;
  policy: TestPolicy;
  superscores: boolean;
  scoreChoice: boolean;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  effectiveCycle: number;
};

export type TargetInput = {
  schools: PolicySchool[];
  attempts: { sectionScores: SectionScores; composite: number | null }[];
  rule: CompositeRule;
  schema: TestSectionSchema;
};

/** Why one school did or didn't contribute to the target. */
export type SchoolContribution = {
  schoolId: string;
  schoolName: string;
  policy: TestPolicy;
  /** The bar this school sets, or null when it sets none. */
  bar: number | null;
  /** What this school would actually see, given its superscore policy. */
  seenComposite: number | null;
  contributes: boolean;
  /** Plain language, shown to the student. Never a bare boolean on screen. */
  reason: string;
};

export type DerivedTarget = {
  /** The score that clears the realistic list, or null when nothing binds. */
  bindingComposite: number | null;
  bindingSchoolId: string | null;
  bindingSchoolName: string | null;
  /** A band, because CDS quartiles are a distribution and not a cutoff. */
  bandLow: number | null;
  bandHigh: number | null;
  excludedBlindSchoolIds: string[];
  nonBindingOptionalSchoolIds: string[];
  /** Every school, with why it did or didn't count. The explainability surface. */
  contributions: SchoolContribution[];
};

/**
 * The bar one school sets, from its published quartiles.
 *
 * p50 rather than p75, deliberately. p75 is the 75th percentile of ADMITTED
 * students — a quarter of the people who got in scored below it, so treating it
 * as the requirement tells three-quarters of successful applicants they failed.
 * p50 is the honest reading of "a score that does not count against you here".
 *
 * Falls back down the quartiles rather than giving up, because plenty of schools
 * publish only some of them, and a school with a p25 still tells us something.
 */
export function schoolBar(school: PolicySchool): number | null {
  if (school.policy === "BLIND") return null;
  return school.p50 ?? school.p75 ?? school.p25 ?? null;
}

/**
 * Whether submitting a score to a test-optional school would strengthen it.
 *
 * The rule the whole test-optional branch turns on: a score at or above the
 * middle of the admitted class helps, and one below it is better not sent. When
 * we cannot tell — the school publishes no quartiles, or the student has not
 * sat the test yet — the honest answer is that it does not bind, because
 * inventing a bar out of nothing is exactly what this file exists to avoid.
 */
export function optionalStrengthens(
  school: PolicySchool,
  seenComposite: number | null,
): boolean {
  if (school.policy !== "OPTIONAL") return false;
  const bar = schoolBar(school);
  if (bar === null || seenComposite === null) return false;
  return seenComposite >= bar;
}

/**
 * Derive the target from a list and a score history.
 *
 * Note the order: exclusions first, then classification, then the bar. Running
 * it the other way — computing a maximum and then filtering — is how a blind
 * school ends up setting a target through a max() that already happened.
 */
export function deriveTarget(input: TargetInput): DerivedTarget {
  const { schools, attempts, rule, schema } = input;

  const contributions: SchoolContribution[] = schools.map((school) => {
    // What THIS school would see, which depends on its own superscore policy.
    const seenComposite = compositeAsSchoolSeesIt(
      attempts,
      rule,
      schema,
      school.superscores,
    );
    const bar = schoolBar(school);

    if (school.policy === "BLIND") {
      return {
        schoolId: school.schoolId,
        schoolName: school.schoolName,
        policy: school.policy,
        bar: null,
        seenComposite,
        contributes: false,
        reason: `${school.schoolName} does not look at scores, so it cannot set a target.`,
      };
    }

    if (bar === null) {
      return {
        schoolId: school.schoolId,
        schoolName: school.schoolName,
        policy: school.policy,
        bar: null,
        seenComposite,
        contributes: false,
        reason: `${school.schoolName} publishes no score range we hold, so it sets no bar.`,
      };
    }

    if (school.policy === "OPTIONAL") {
      const strengthens = optionalStrengthens(school, seenComposite);
      return {
        schoolId: school.schoolId,
        schoolName: school.schoolName,
        policy: school.policy,
        bar,
        seenComposite,
        contributes: strengthens,
        reason: strengthens
          ? `${school.schoolName} is test-optional, and this score is at or above its middle 50%, so sending it helps.`
          : `${school.schoolName} is test-optional. A score below its middle 50% is better not sent, so it does not raise the target.`,
      };
    }

    return {
      schoolId: school.schoolId,
      schoolName: school.schoolName,
      policy: school.policy,
      bar,
      seenComposite,
      contributes: true,
      reason: `${school.schoolName} requires a score, and its middle 50% starts at ${bar}.`,
    };
  });

  const binding = contributions.filter((c) => c.contributes && c.bar !== null);

  const excludedBlindSchoolIds = contributions
    .filter((c) => c.policy === "BLIND")
    .map((c) => c.schoolId);
  const nonBindingOptionalSchoolIds = contributions
    .filter((c) => c.policy === "OPTIONAL" && !c.contributes)
    .map((c) => c.schoolId);

  if (binding.length === 0) {
    return {
      bindingComposite: null,
      bindingSchoolId: null,
      bindingSchoolName: null,
      bandLow: null,
      bandHigh: null,
      excludedBlindSchoolIds,
      nonBindingOptionalSchoolIds,
      contributions,
    };
  }

  // The highest bar on the list is the one that binds — clearing it clears
  // everything below it. Ties break on the lowest school id so the naming
  // school is stable across recomputations rather than flickering between two
  // schools that happen to ask the same thing.
  const strictest = binding.reduce((a, b) => {
    if (b.bar! > a.bar!) return b;
    if (b.bar! < a.bar!) return a;
    return b.schoolId < a.schoolId ? b : a;
  });

  const bindingSchool = schools.find((s) => s.schoolId === strictest.schoolId)!;

  // The BAND, from the naming school's own quartiles. p25→p75 where both are
  // published, so the student sees the spread they are actually aiming into
  // rather than a single number pretending to be a cutoff.
  const bandLow = bindingSchool.p25 ?? bindingSchool.p50 ?? strictest.bar;
  const bandHigh = bindingSchool.p75 ?? bindingSchool.p50 ?? strictest.bar;

  return {
    bindingComposite: strictest.bar,
    bindingSchoolId: strictest.schoolId,
    bindingSchoolName: strictest.schoolName,
    bandLow,
    bandHigh,
    excludedBlindSchoolIds,
    nonBindingOptionalSchoolIds,
    contributions,
  };
}

/** Where the student stands against the derived band. */
export function targetStatus(
  seenComposite: number | null,
  target: DerivedTarget,
): "GAP_REMAINS" | "IN_BAND" | "CLEARED" {
  if (seenComposite === null || target.bindingComposite === null) {
    return "GAP_REMAINS";
  }
  // CLEARED means the top of the band is behind them — every school on the list
  // is comfortably satisfied and there is nothing left for points to buy.
  if (target.bandHigh !== null && seenComposite >= target.bandHigh) {
    return "CLEARED";
  }
  if (seenComposite >= target.bindingComposite) return "IN_BAND";
  return "GAP_REMAINS";
}
