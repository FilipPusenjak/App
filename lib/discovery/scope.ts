// Activity Discovery — the widening ladder.
//
// One high school will almost never have ten opted-in students in one major
// category, especially in the first months. Rather than show nothing, the query
// widens: same school and major and year, then same school and major, then
// broader, until a scope holds enough students to hide any one of them.
//
// The rule that makes widening honest rather than a fudge: THE SCOPE THAT
// RESOLVED IS ALWAYS REPORTED, and the UI states it plainly. "Students at
// schools like yours" is a weaker claim than "students at your school" and the
// student is entitled to know which one they are reading. Silently presenting a
// national aggregate as a school-level one would be the actual harm here —
// it would make a national baseline look like local competition.
//
// Pure policy: the ladder's order and labels live here with no database, so the
// order can be tested directly. The counting happens elsewhere.

/**
 * In order, narrowest first. The first scope whose cohort clears
 * MIN_COHORT_SIZE wins.
 *
 * The order is not arbitrary. Each step gives up exactly one dimension of
 * specificity, so the answer degrades predictably rather than jumping from
 * "your school" to "the country". Year goes first because it is the least
 * informative for this purpose — what students two years above did is still
 * a good guide to what exists at your school. School identity goes last,
 * because "at my school" is the whole reason a student reads this.
 */
export const SCOPE_LADDER = [
  "SCHOOL_MAJOR_YEAR",
  "SCHOOL_MAJOR",
  "SCHOOL_MAJOR_GROUP",
  "REGION_SIMILAR_SCHOOLS_MAJOR",
  "NATIONAL_MAJOR",
] as const;

export type DiscoveryScope = (typeof SCOPE_LADDER)[number];

/**
 * What each scope is, in the words shown to the student.
 *
 * Written to be read by a 15-year-old and to never overclaim. Each one says
 * who is actually in the group, so a student can judge how much the numbers
 * apply to them.
 */
export const SCOPE_LABELS: Record<DiscoveryScope, string> = {
  SCHOOL_MAJOR_YEAR:
    "Students at your school, aiming at a similar subject, in your year group",
  SCHOOL_MAJOR: "Students at your school aiming at a similar subject",
  SCHOOL_MAJOR_GROUP: "Students at your school in a related field",
  REGION_SIMILAR_SCHOOLS_MAJOR:
    "Students at schools like yours, aiming at a similar subject",
  NATIONAL_MAJOR: "Students aiming at a similar subject, nationally",
};

/**
 * A one-line caveat for scopes that are NOT the student's own school, so the
 * distinction survives being skim-read. Null where no caveat is needed.
 */
export const SCOPE_CAVEATS: Record<DiscoveryScope, string | null> = {
  SCHOOL_MAJOR_YEAR: null,
  SCHOOL_MAJOR: null,
  SCHOOL_MAJOR_GROUP:
    "Not enough students in your exact subject yet, so this covers a wider field.",
  REGION_SIMILAR_SCHOOLS_MAJOR:
    "Not enough students at your school yet — these are other schools of a similar size and type, so some of it may not be available to you.",
  NATIONAL_MAJOR:
    "This is a national picture, not your school. Some of it will not exist where you are.",
};

/** True for the scopes that genuinely describe the student's own school. */
export function isOwnSchoolScope(scope: DiscoveryScope): boolean {
  return (
    scope === "SCHOOL_MAJOR_YEAR" ||
    scope === "SCHOOL_MAJOR" ||
    scope === "SCHOOL_MAJOR_GROUP"
  );
}

/**
 * Walk the ladder and return the first scope that clears the threshold.
 *
 * `sizeOf` reports the distinct STUDENT count for a scope with the viewing
 * ACCOUNT's own students already removed — see policy.ts for why the exclusion
 * is per account rather than per student. It is called lazily and in order, so
 * a resolved narrow scope costs one count rather than five.
 *
 * Returns null when nothing resolves, which the API turns into an empty state.
 * An empty state is the correct answer, not an error and not a partial result:
 * there is no smaller amount of data that would be safe to show instead.
 */
export async function resolveScope(
  sizeOf: (scope: DiscoveryScope) => Promise<number>,
  isReportable: (distinctStudents: number) => boolean,
): Promise<{ scope: DiscoveryScope; distinctStudents: number } | null> {
  for (const scope of SCOPE_LADDER) {
    const distinctStudents = await sizeOf(scope);
    if (isReportable(distinctStudents)) return { scope, distinctStudents };
  }
  return null;
}
