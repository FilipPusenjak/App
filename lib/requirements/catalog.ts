// What courses do we actually hold requirements for, at a given university?
//
// The other half of the matching problem. Aliases fixed the university name;
// this fixes the course name, and it fixes it at the point where the mismatch
// is created rather than trying to repair it afterwards.
//
// Repairing it afterwards was the alternative, and it is worse. Loosening the
// course match — leading words, fuzzy distance, anything — buys coverage by
// accepting that "Medicine (A100)" might resolve to "Medicine (A101)". Those
// are different courses with different requirements, and showing one under the
// other is precisely the confident wrong answer the whole lookup path refuses
// to produce. Offering the real names instead means the student picks a course
// that exists, and the match is exact because it was never approximate.
//
// SERVER ONLY. Reference data shared by every student and owned by nobody, so
// there is no ownership filter here — same reasoning as lookup.ts. The route
// that exposes it still requires a signed-in user, because a private app should
// not hand its research out to anyone who asks.
import { prisma } from "@/lib/db";
import { candidateUniversities } from "./resolve";

/** Plenty for a course list, low enough that a vague name cannot dump the table. */
const MAX_COURSES = 200;

/**
 * Course names held for a university, exactly as stored.
 *
 * Exactly as stored is the point: these strings are what the student's target
 * has to equal for the lookup to hit, so anything prettied up here would
 * reintroduce the mismatch this exists to remove.
 */
export async function coursesForUniversity(
  name: string,
  country: string,
): Promise<string[]> {
  const iso = country.trim().toUpperCase();
  if (!name.trim() || iso.length !== 2) return [];

  // Every spelling of the university the matcher would accept, so the course
  // list appears for "UCL" and "University College London" alike — the picker
  // is useless if it only works once the name is already perfect.
  const universities = candidateUniversities(name, iso).filter(Boolean);
  if (universities.length === 0) return [];

  const rows = await prisma.courseRequirement.findMany({
    where: {
      OR: universities.map((university) => ({
        matchKey: { startsWith: `${iso}::${university}::` },
      })),
    },
    select: { course: true, university: true },
    take: MAX_COURSES,
    orderBy: { course: "asc" },
  });

  // A name reaching two institutions is ambiguous, and the same rule applies
  // here as in the lookup: offering a merged list would invite the student to
  // pick a course from the wrong school, which is how a wrong match would get
  // created by hand instead of by the matcher.
  const distinct = new Set(rows.map((row) => row.university));
  if (distinct.size > 1) return [];

  return [...new Set(rows.map((row) => row.course))];
}
