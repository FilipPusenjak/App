// Turning what a student typed into the keys worth looking up.
//
// Three ways a name can reach its canonical form — a curated alias, the
// institution's own acronym, or a mechanical "University of X" rewrite — and
// this is where they combine. It stays pure so the interesting property can be
// tested directly: WHEN THE ANSWER IS AMBIGUOUS, THERE IS NO ANSWER.
//
// That last rule is the whole safety argument. Expanding one typed name into
// several candidates is the one change here that could produce a WRONG match
// rather than merely a missing one, so a set of candidates that could describe
// two different institutions resolves to nothing at all, and the evaluation
// says "check the course page" exactly as it does today.
import { curatedAlias, splitTrailingAcronym } from "./aliases";
import { normalizeName, normalizeUniversity, universityVariants } from "./match";

/**
 * Every canonical university name a typed name might mean.
 *
 * Order is not significance — the caller must treat more than one entry as
 * ambiguity, not as a ranked list to pick from.
 */
export function candidateUniversities(raw: string, country: string): string[] {
  const canonical = normalizeUniversity(raw);
  if (!canonical) return [];

  const out = new Set<string>();

  // 1. The name as written.
  out.add(canonical);

  // 2. A curated alias, if this exact string is one.
  const curated = curatedAlias(canonical, country);
  if (curated) out.add(curated);

  // 3. The acronym a student may have typed instead of the name, and the name
  //    they may have typed instead of the acronym. "University College London
  //    (UCL)" means both are the same place, stated by the source itself.
  const { acronym } = splitTrailingAcronym(raw);
  if (acronym) {
    const asAlias = curatedAlias(normalizeName(acronym), country);
    if (asAlias) out.add(asAlias);
  }

  // 4. Mechanical rewrites, applied to everything gathered so far so that
  //    "ucl" -> "university college london" can also reach a record stored
  //    under a variant of that.
  for (const name of [...out]) {
    for (const variant of universityVariants(name)) out.add(variant);
  }

  return [...out];
}

/**
 * The keys to look for, given a student's target.
 *
 * Returns an empty list when the target cannot be looked up at all: no course
 * (a university-level guess at course-specific requirements is precisely the
 * wrong match this avoids), or a name that is entirely noise.
 */
export function candidateKeys(target: {
  name: string;
  country: string;
  course: string | null;
}): string[] {
  if (!target.course) return [];
  const course = normalizeName(target.course);
  if (!course) return [];

  const country = target.country.trim().toUpperCase();
  if (!country) return [];

  return candidateUniversities(target.name, country)
    .filter((university) => university.length > 0)
    .map((university) => `${country}::${university}::${course}`);
}
