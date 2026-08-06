// Activity Discovery — the disclosure rules.
//
// Everything in this file exists to stop an aggregate identifying a child. It
// is deliberately pure: no database, no session, no network. The rules can
// therefore be tested directly and exhaustively, rather than inferred from the
// behaviour of a query someone might later edit.
//
// The threat is not an outsider scraping the site. It is a classmate who
// already knows most of the cohort. At one high school, "students doing
// pre-med" is a handful of people, and any one of them can subtract themselves
// and their friends from a published count. So the rules below are about what
// survives an attacker who already holds most of the answer:
//
//   - a cohort too small to hide anyone returns nothing at all
//   - a rare activity is dropped even from a valid cohort
//   - counts are buckets, because exact integers subtract
//   - suppression is silent, because "3 rows hidden" is itself a count
//
// WHO COUNTS AS ONE PERSON — the adaptation this app forces.
//
// The original design assumed one account is one student. Here an account can
// hold many students: a counselor or agency runs a whole caseload from one
// login. That changes two things, and getting either wrong voids the whole
// guarantee.
//
//   1. A cohort is counted in STUDENTS (profiles), not accounts. Counting
//      accounts would mean a counselor's twelve real students registered as one
//      contributor and no cohort ever reached the threshold.
//
//   2. The viewer is excluded by ACCOUNT, not by student. This is the part that
//      is easy to get wrong and expensive to get wrong. A counselor with nine
//      pre-med students at one school, viewing a ten-student cohort, would
//      otherwise be shown an aggregate whose tenth member they could identify
//      by subtracting the nine they already know. Excluding every profile the
//      viewing account owns collapses that cohort to one, which then fails the
//      threshold and returns nothing — which is the correct answer.
//
// Not defended here: an account that manufactures profiles to inflate a cohort
// it then views through a second account. That is collusion between accounts,
// which k-anonymity does not address and which no threshold fixes.

/** Distinct STUDENTS required before a cohort may be reported at all. */
export const MIN_COHORT_SIZE = readThreshold("DISCOVERY_MIN_COHORT_SIZE", 10);

/** Distinct students required before one activity may be displayed. */
export const MIN_ACTIVITY_COUNT = readThreshold(
  "DISCOVERY_MIN_ACTIVITY_COUNT",
  5,
);

/**
 * Activities that name a single person — a named fellowship, a national team
 * place, a one-winner award — need twice the usual support. Five students
 * "doing research" is a category; five students holding the same named
 * fellowship is a list of five names.
 */
export const IDENTIFYING_MULTIPLIER = 2;

function readThreshold(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  // A malformed or permissive value must not silently weaken the floor: an
  // env typo should never be the reason a child is identifiable.
  if (!Number.isFinite(parsed) || parsed < fallback) return fallback;
  return parsed;
}

/**
 * The only count shapes that ever leave the server.
 *
 * Exact integers are the differencing attack: ask today, ask after one student
 * joins, and the difference is that student. Buckets absorb the delta.
 */
export type CountBucket = "5-9" | "10-19" | "20+";
export type CohortBucket = "10-19" | "20+";

/**
 * Bucket a raw count, or null when it is below the floor and must be withheld.
 *
 * Returning null rather than a "too small" marker is deliberate: the caller
 * must not be able to distinguish "suppressed" from "absent", because that
 * distinction is itself the leak (rule 2 in the spec — suppress silently).
 */
export function bucketActivityCount(
  count: number,
  options: { isHighlyIdentifying?: boolean } = {},
): CountBucket | null {
  const floor = options.isHighlyIdentifying
    ? MIN_ACTIVITY_COUNT * IDENTIFYING_MULTIPLIER
    : MIN_ACTIVITY_COUNT;
  if (!Number.isFinite(count) || count < floor) return null;
  if (count < 10) return "5-9";
  if (count < 20) return "10-19";
  return "20+";
}

/**
 * Bucket a cohort size, or null when the cohort is too small to report.
 *
 * There is no "5-9" here on purpose. A cohort that small never surfaces, so a
 * bucket for it would be a shape the API can never legitimately return.
 */
export function bucketCohortSize(count: number): CohortBucket | null {
  if (!Number.isFinite(count) || count < MIN_COHORT_SIZE) return null;
  return count < 20 ? "10-19" : "20+";
}

/** True when a cohort has enough distinct students to hide any one of them. */
export function isReportableCohort(distinctStudents: number): boolean {
  return Number.isFinite(distinctStudents) && distinctStudents >= MIN_COHORT_SIZE;
}

/**
 * A rung distribution, bucketed and suppressed rung by rung.
 *
 * The distribution is a second way to ask the same question: if an activity
 * clears the floor at 6 students but only one of them is NATIONAL, publishing
 * the rung breakdown re-identifies that one. So every rung is bucketed against
 * the same floor, and rungs that fall below it are dropped from the object
 * entirely rather than reported as zero — an explicit zero would say "nobody
 * here", which is also information about a named individual's absence.
 */
export function bucketRungDistribution(
  counts: Record<string, number>,
  options: { isHighlyIdentifying?: boolean } = {},
): Record<string, CountBucket> {
  const out: Record<string, CountBucket> = {};
  for (const [rung, count] of Object.entries(counts)) {
    const bucket = bucketActivityCount(count, options);
    if (bucket) out[rung] = bucket;
  }
  return out;
}
