// Matching a student's target to a researched course record.
//
// A student types "Cambridge" or "University of Cambridge" or "cambridge uni";
// the research file says "University of Cambridge". Exact string equality would
// miss almost every real pair, so names are normalized to a match key.
//
// The rule that governs every decision here: A WRONG MATCH IS FAR WORSE THAN NO
// MATCH. No match means the evaluation carries on exactly as it does today,
// saying "check the official course page" — the status quo, and safe. A wrong
// match means the app confidently shows a student Trinity College Dublin's
// medicine requirements under Trinity College Cambridge, sourced and dated and
// looking authoritative.
//
// So normalization only removes noise that cannot change identity — case,
// punctuation, spacing, and a small set of generic words. It never does fuzzy
// or partial matching, never picks a "closest" candidate, and requires the
// COUNTRY to agree, because course and university names repeat across borders.
//
// Policy only: no database. The lookup that uses it lives in lookup.ts.

/**
 * Words that carry no identifying information in a university name.
 *
 * THREE WORDS, and it took a failing test to get here. The first version also
 * dropped "university", "college" and "uni" — which felt harmless and was not:
 * "University College London" collapsed to "london" and collided with a
 * student who had typed "London". Those words are load-bearing in real names
 * (University College London, Imperial College London, Trinity College), and
 * removing them merges institutions that are nothing like each other.
 *
 * Every word added here is a word that can no longer tell two universities
 * apart. Given that a wrong match is far worse than no match, the list stays
 * at the three that genuinely never distinguish anything.
 *
 * The cost is real and accepted: a student who types "Cambridge" will NOT
 * match a record for "University of Cambridge". That is a miss, and a miss is
 * simply today's behaviour — the evaluation says "check the course page".
 * Closing that gap needs an alias table, not a longer noise list.
 */
const NOISE_WORDS = new Set(["the", "of", "at"]);

/**
 * Normalize a name to a comparable key.
 *
 * Lowercases, strips accents and punctuation, drops the noise words above, and
 * collapses whitespace. Accents go because a student typing "Universitat" and a
 * source saying "Universität" mean the same place; nothing else about the name
 * is touched.
 */
export function normalizeName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Apostrophes are ELIDED, not turned into spaces: "King's" must become
    // "kings", not "king s", or it fails to match the same name typed plainly.
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !NOISE_WORDS.has(word))
    .join(" ")
    .trim();
}

/**
 * A university name reduced to its canonical form.
 *
 * Separate from normalizeName because a university name and a course name need
 * DIFFERENT treatment of one thing: the trailing parenthetical. On a university
 * it is the institution's own acronym and carrying it into the key is what made
 * "University College London (UCL)" store as `university college london ucl` —
 * a string no student types, so the full correct name missed. On a course it is
 * load-bearing ("Medicine (A100)", "Computer Science and Engineering (SB,
 * Course 6-3)") and stripping it would merge distinct courses.
 *
 * So the strip happens here and never inside normalizeName.
 */
export function normalizeUniversity(raw: string): string {
  // Imported lazily-by-structure rather than at module top: aliases.ts imports
  // normalizeName from here, and a static import back would be a cycle.
  const match = /\s*\(([A-Za-z]{2,10})\)\s*$/.exec(raw);
  return normalizeName(match ? raw.slice(0, match.index) : raw);
}

/**
 * Safe rewrites of a canonical university name.
 *
 * Covers the single most common mismatch — a student writes "Cambridge", the
 * source says "University of Cambridge" — without the fuzzy matching this file
 * refuses to do. Each rule is reversible and adds a name rather than replacing
 * one, so a variant that matches nothing costs nothing.
 *
 * The "college" guard is the lesson from the noise-word list, in a narrower
 * form: dropping a leading "university" from "university college london" would
 * yield "college london", and from there the collisions start. Names that begin
 * "university college" keep their prefix.
 */
export function universityVariants(normalized: string): string[] {
  const out = new Set<string>([normalized]);
  if (!normalized) return [];

  if (normalized.startsWith("university ")) {
    const rest = normalized.slice("university ".length);
    if (rest && !rest.startsWith("college")) out.add(rest);
  }
  if (normalized.endsWith(" university")) {
    const rest = normalized.slice(0, -" university".length);
    if (rest) out.add(rest);
  }
  // The other direction: the student typed the short form.
  if (!normalized.startsWith("university")) out.add(`university ${normalized}`);
  if (!normalized.endsWith("university")) out.add(`${normalized} university`);

  return [...out];
}

/**
 * The key a record is stored and looked up under.
 *
 * Country is part of the key rather than a secondary filter, so a lookup
 * physically cannot return a record from another country — "Trinity College,
 * Medicine" exists in both IE and GB and they are different requirements.
 */
export function matchKey(input: {
  university: string;
  country: string;
  course: string;
}): string {
  const university = normalizeUniversity(input.university);
  const course = normalizeName(input.course);
  const country = input.country.trim().toUpperCase();
  return `${country}::${university}::${course}`;
}

/**
 * True when a key can be used at all.
 *
 * A blank university or course after normalization means the name was entirely
 * noise words ("The University"), which identifies nothing. Better to have no
 * key than one that collides with every other vague entry.
 */
export function isUsableKey(key: string): boolean {
  const [country, university, course] = key.split("::");
  return Boolean(country && university && course);
}
