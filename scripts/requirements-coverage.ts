// Which of the courses students actually target do we have requirements for?
//
//   DATABASE_URL="<production>" npx tsx scripts/requirements-coverage.ts
//   DATABASE_URL="<production>" npx tsx scripts/requirements-coverage.ts --missing > next-wave.txt
//
// "839 records" is a number nobody can act on. It does not say whether those
// records cover the schools students are asking about or 839 courses nobody has
// ever targeted. This answers the question that actually decides what to
// research next: of the pairs students HAVE targeted, which resolve to a
// record, and which do not.
//
// It resolves through the real matcher — aliases, acronyms and all — so a pair
// reported as missing is genuinely missing rather than merely spelled
// differently. That distinction is the point: a name that fails to match is a
// matcher bug and belongs in aliases.ts, while a pair with no data is a
// research job. Telling them apart by hand is what this replaces.
//
// OPERATOR SCRIPT. It aggregates across all accounts, which is why it is a CLI
// tool run with an explicit DATABASE_URL and not a route. It prints university
// and course names and a count — a list of places, never of people.
import { prisma } from "../lib/db";
import { candidateKeys } from "../lib/requirements/resolve";
import { isUsableKey, normalizeName, normalizeUniversity } from "../lib/requirements/match";
import { curatedAlias, splitTrailingAcronym } from "../lib/requirements/aliases";

const args = process.argv.slice(2);
const missingOnly = args.includes("--missing");

type Pair = {
  name: string;
  country: string;
  course: string | null;
  students: number;
};

async function main() {
  const targets = await prisma.targetSchool.findMany({
    select: { name: true, country: true, course: true },
  });

  // Collapse to distinct pairs, counting how many targets each represents. The
  // count is what makes this a priority list rather than an inventory.
  const pairs = new Map<string, Pair>();
  for (const t of targets) {
    const key = `${t.country}::${t.name.toLowerCase()}::${(t.course ?? "").toLowerCase()}`;
    const existing = pairs.get(key);
    if (existing) existing.students += 1;
    else pairs.set(key, { ...t, students: 1 });
  }

  const covered: Pair[] = [];
  const missing: Pair[] = [];
  const noCourse: Pair[] = [];

  // One query for every candidate key across every pair, rather than a query
  // per pair: this runs against production and the target list only grows.
  const keysByPair = new Map<string, string[]>();
  const allKeys = new Set<string>();
  for (const [key, pair] of pairs) {
    if (!pair.course?.trim()) {
      noCourse.push(pair);
      continue;
    }
    const keys = candidateKeys(pair).filter(isUsableKey);
    keysByPair.set(key, keys);
    for (const k of keys) allKeys.add(k);
  }

  const found = new Set(
    (
      await prisma.courseRequirement.findMany({
        where: { matchKey: { in: [...allKeys] } },
        select: { matchKey: true },
      })
    ).map((r) => r.matchKey),
  );

  for (const [key, keys] of keysByPair) {
    const pair = pairs.get(key)!;
    if (keys.some((k) => found.has(k))) covered.push(pair);
    else missing.push(pair);
  }

  const byDemand = (a: Pair, b: Pair) =>
    b.students - a.students || a.name.localeCompare(b.name);
  covered.sort(byDemand);
  missing.sort(byDemand);

  // --missing prints ONLY the research list, on stdout, so it can be redirected
  // straight into the next wave's brief.
  if (missingOnly) {
    console.error(`# ${missing.length} uncovered pair(s), most-targeted first.`);
    console.error(`# Paste after the research brief.\n`);
    for (const p of missing) console.log(`${p.name} | ${p.course}`);
    await prisma.$disconnect();
    return;
  }

  const total = covered.length + missing.length;
  const pct = total > 0 ? Math.round((covered.length / total) * 100) : 0;
  const rows = await prisma.courseRequirement.count();

  console.log(`\n  requirement rows stored : ${rows}`);
  console.log(`  distinct targeted pairs : ${total}`);
  console.log(`  covered                 : ${covered.length} (${pct}%)`);
  console.log(`  not covered             : ${missing.length}`);
  if (noCourse.length > 0) {
    console.log(
      `  no course named         : ${noCourse.length} — cannot be looked up at all;\n` +
        `                            course-specific requirements need a course.`,
    );
  }

  // A miss is not one thing, and the two kinds need opposite responses. If the
  // university is already researched, the course NAME differs — the data exists
  // and researching it again would produce a duplicate under a third spelling.
  // If the university is absent entirely, that is a genuine research job. A
  // single "not covered" number hides which of those you are looking at.
  const known = await knownUniversityPrefixes();
  const wrongCourseName: Pair[] = [];
  const notResearched: Pair[] = [];
  for (const pair of missing) {
    const prefixes = candidateKeys(pair)
      .filter(isUsableKey)
      .map((k) => k.split("::").slice(0, 2).join("::"));
    if (prefixes.some((p) => known.has(p))) wrongCourseName.push(pair);
    else notResearched.push(pair);
  }

  if (wrongCourseName.length > 0) {
    console.log(
      `\n  Course name differs — WE HAVE THIS UNIVERSITY, so these need a name fix,\n` +
        `  not more research:\n`,
    );
    for (const p of wrongCourseName.slice(0, 15)) {
      console.log(
        `    ${String(p.students).padStart(3)}x  ${p.name} — "${p.course}" (${p.country})`,
      );
      for (const actual of await coursesAt(p)) {
        console.log(`             we have: "${actual}"`);
      }
    }
    if (wrongCourseName.length > 15) {
      console.log(`    ... and ${wrongCourseName.length - 15} more.`);
    }
  }

  if (notResearched.length > 0) {
    console.log(`\n  Not researched at all — the real list for the next wave:\n`);
    for (const p of notResearched.slice(0, 25)) {
      console.log(
        `    ${String(p.students).padStart(3)}x  ${p.name} — ${p.course} (${p.country})`,
      );
    }
    if (notResearched.length > 25) {
      console.log(`    ... and ${notResearched.length - 25} more.`);
    }
    console.log(
      `\n  Re-run with --missing to get this as a plain list for the research brief.`,
    );
  }

  await reportUnreachableAcronyms();

  if (covered.length > 0) {
    console.log(`\n  Covered:\n`);
    for (const p of covered.slice(0, 15)) {
      console.log(
        `    ${String(p.students).padStart(3)}x  ${p.name} — ${p.course} (${p.country})`,
      );
    }
    if (covered.length > 15) console.log(`    ... and ${covered.length - 15} more.`);
  }
  console.log("");

  await prisma.$disconnect();
}

/** The `COUNTRY::university` half of every stored key, for classifying a miss. */
async function knownUniversityPrefixes(): Promise<Set<string>> {
  const rows = await prisma.courseRequirement.findMany({ select: { matchKey: true } });
  return new Set(rows.map((r) => r.matchKey.split("::").slice(0, 2).join("::")));
}

/**
 * Course names we DO hold at a pair's university — the near misses.
 *
 * Filtered to courses sharing a real word with what the student typed. An
 * alphabetical sample would answer "does this university have data" (already
 * known by this point) instead of the question actually being asked, which is
 * "what is this course called in the data". Showing Architecture and Classics
 * to someone who typed "Computer Science" is noise.
 */
async function coursesAt(pair: Pair): Promise<string[]> {
  const prefixes = candidateKeys(pair)
    .filter(isUsableKey)
    .map((k) => k.split("::").slice(0, 2).join("::"));
  if (prefixes.length === 0) return [];

  const words = normalizeName(pair.course ?? "")
    .split(" ")
    .filter((w) => w.length > 3);

  const where = {
    OR: prefixes.map((p) => ({ matchKey: { startsWith: `${p}::` } })),
    ...(words.length > 0
      ? { AND: [{ OR: words.map((w) => ({ course: { contains: w, mode: "insensitive" as const } })) }] }
      : {}),
  };

  const rows = await prisma.courseRequirement.findMany({
    where,
    select: { course: true },
    take: 3,
    orderBy: { course: "asc" },
  });
  // Nothing shares a word: the course genuinely is not held here, even though
  // the university is. Say so rather than printing an unrelated sample.
  if (rows.length === 0) return ["(no course with a similar name — may be genuinely missing)"];
  return rows.map((r) => r.course);
}

/**
 * Stored names whose own acronym nothing can look up.
 *
 * A record named "University College London (UCL)" states that "UCL" means it.
 * Stripping the parenthetical makes the full name match, but a student typing
 * just the acronym has no parenthetical in THEIR input for anything to read, so
 * the equivalence has to be enumerated in aliases.ts — and nothing about a
 * missing entry is visible: the record simply never matches that name, forever,
 * silently.
 *
 * So every research wave gets checked. This is the maintenance trap made loud.
 */
async function reportUnreachableAcronyms() {
  const rows = await prisma.courseRequirement.findMany({
    select: { university: true, country: true },
    distinct: ["university", "country"],
  });

  const gaps: string[] = [];
  for (const row of rows) {
    const { acronym } = splitTrailingAcronym(row.university);
    if (!acronym) continue;
    const canonical = normalizeUniversity(row.university);
    if (curatedAlias(normalizeName(acronym), row.country) !== canonical) {
      gaps.push(`${row.university} (${row.country}) — "${acronym}" resolves to nothing`);
    }
  }

  if (gaps.length === 0) return;
  console.log(`\n  Acronyms nothing can look up — add these to lib/requirements/aliases.ts:\n`);
  for (const gap of gaps) console.log(`    ${gap}`);
  console.log(
    `\n  Until then a student typing that acronym gets "check the course page",\n` +
      `  even though the data is sitting right there.`,
  );
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
