// The names students actually type for a university.
//
// The matcher deliberately refuses to guess: it normalizes away only noise that
// cannot change identity, and everything else must match exactly. That rule is
// right — a wrong match shows a student one institution's requirements under
// another's name, sourced and dated and looking authoritative — but on its own
// it means "Cambridge", "UCL" and "UT Austin" find nothing.
//
// This closes that gap the only way that keeps the rule intact: by ENUMERATING
// the equivalences rather than inferring them. Every entry below is a deliberate
// claim that two names are the same institution, reviewable in a diff.
//
// Three sources of equivalence, in order of how much they can be trusted:
//
//   1. Mechanical  — "University of X" and "X University" and "X". Derivable,
//                    and the derivation is narrow enough to be safe (see
//                    universityVariants in match.ts).
//   2. Data-derived — a name like "University College London (UCL)" states its
//                    own acronym. Read it off rather than hand-maintain it.
//   3. Curated     — everything else. The table below.
//
// Pure policy: no database.
import { normalizeName } from "./match";

/**
 * A trailing parenthetical that is the institution's own acronym.
 *
 * "University College London (UCL)" is one name carrying two, and treating the
 * whole string as one token was actively harmful: the stored key became
 * `university college london ucl`, which nobody types, so the FULL CORRECT NAME
 * failed to match. Sixty of the first 839 researched records — MIT, UCL and TUM
 * — were unreachable by any name a student would write.
 *
 * Only uppercase-ish short tokens count. Course names carry parentheticals that
 * are not acronyms and must never be stripped ("Medicine (A100)", "Computer
 * Science and Engineering (SB, Course 6-3)"), which is why this is applied to
 * university names ONLY and never inside normalizeName.
 */
const TRAILING_ACRONYM = /\s*\(([A-Za-z]{2,10})\)\s*$/;

/** The name without its trailing acronym, and the acronym if there was one. */
export function splitTrailingAcronym(raw: string): {
  name: string;
  acronym: string | null;
} {
  const match = TRAILING_ACRONYM.exec(raw);
  if (!match) return { name: raw.trim(), acronym: null };
  return {
    name: raw.slice(0, match.index).trim(),
    acronym: match[1]!.trim(),
  };
}

/**
 * Curated equivalences, keyed by country.
 *
 * Country-scoped because short forms are only unambiguous inside one: names
 * repeat across borders, and the matcher already refuses to cross them.
 *
 * WHAT IS DELIBERATELY ABSENT MATTERS AS MUCH AS WHAT IS HERE. Each of these
 * was considered and left out because it names more than one institution, and
 * an alias that is right most of the time is exactly the confident wrong match
 * this file exists to prevent:
 *
 *   "penn"     — University of Pennsylvania and Penn State are different
 *                schools that students confuse in real life. "upenn" is safe.
 *   "berkeley" — Berkeley College is a real, unrelated institution.
 *                "uc berkeley" is safe.
 *   "trinity"  — Trinity College Dublin, Trinity College Cambridge, Trinity
 *                College Oxford. Nothing here can tell them apart.
 *   "st andrews" and the other bare city names — handled mechanically instead,
 *                which is narrower and needs no judgement call.
 *
 * Keys must be written as normalizeName would produce them: lowercase, no
 * punctuation, without "the", "of" or "at". A test enforces that, because an
 * entry that never normalizes to its own key is silently dead.
 */
const CURATED: Record<string, Record<string, string>> = {
  GB: {
    // Stripping "(UCL)" out of the stored name is only half the job: it makes
    // the full name match, but a student typing the acronym alone still has
    // nothing to match against, because there is no parenthetical in THEIR
    // input to read it from. The acronym has to be enumerated like any other.
    "ucl": "university college london",
    "kcl": "kings college london",
    "imperial": "imperial college london",
    "imperial college": "imperial college london",
    "lse": "london school economics",
    "london school economics and political science": "london school economics",
    "qmul": "queen mary university london",
    "soas": "soas university london",
  },
  US: {
    "mit": "massachusetts institute technology",
    "cmu": "carnegie mellon university",
    "gatech": "georgia institute technology",
    "georgia tech": "georgia institute technology",
    "jhu": "johns hopkins university",
    "nyu": "new york university",
    "uc berkeley": "university california berkeley",
    "ucb": "university california berkeley",
    "ucla": "university california los angeles",
    "uc los angeles": "university california los angeles",
    "ucsd": "university california san diego",
    "uc san diego": "university california san diego",
    "upenn": "university pennsylvania",
    "ut austin": "university texas austin",
    "umich": "university michigan ann arbor",
    "university michigan": "university michigan ann arbor",
    "caltech": "california institute technology",
    "uchicago": "university chicago",
  },
  CH: {
    "eth": "eth zurich",
    "eth zuerich": "eth zurich",
    "swiss federal institute technology": "eth zurich",
  },
  DE: {
    "tum": "technical university munich",
    "tu munich": "technical university munich",
    "technische universitat munchen": "technical university munich",
  },
};

/**
 * The canonical name a curated alias points at, or null.
 *
 * `normalized` must already have been through normalizeName.
 */
export function curatedAlias(
  normalized: string,
  country: string,
): string | null {
  const table = CURATED[country.trim().toUpperCase()];
  return table?.[normalized] ?? null;
}

/** Every curated alias, for the tests that check the table itself is sane. */
export function allCuratedAliases(): {
  country: string;
  alias: string;
  canonical: string;
}[] {
  const out: { country: string; alias: string; canonical: string }[] = [];
  for (const [country, table] of Object.entries(CURATED)) {
    for (const [alias, canonical] of Object.entries(table)) {
      out.push({ country, alias, canonical });
    }
  }
  return out;
}

/** Re-exported so callers need only this module. */
export { normalizeName };
