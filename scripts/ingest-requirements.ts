// Ingest researched course requirements from an agent's JSON file.
//
//   npx tsx scripts/ingest-requirements.ts path/to/course-requirements-2026-08-08.json
//   npx tsx scripts/ingest-requirements.ts --dry-run path/to/file.json
//
// Every record is validated before it is written, and a rejected record does
// NOT abort the batch — the useful outcome is "40 landed, 6 did not, here is
// exactly why", not a stack trace on the seventh. Anything rejected simply
// never becomes data, and the evaluation carries on saying "check the course
// page" for that course, which is what it does today.
//
// --dry-run validates and reports without touching the database. Run it first.
import { readFileSync } from "node:fs";
import { prisma } from "../lib/db";
import {
  REQUIREMENT_FIELDS,
  validateRecord,
} from "../lib/validation/course-requirements";
import { isUsableKey, matchKey, normalizeUniversity } from "../lib/requirements/match";

/**
 * The fields a student can actually act on when choosing subjects.
 *
 * `applicationRoute`, `interview` and `workExperience` are real requirements
 * but none of them changes what a 15-year-old should study, and all three are
 * routinely stated on an institution-wide page that says nothing about the
 * course.
 */
const DECISION_RELEVANT = [
  "gradeRequirement",
  "requiredSubjects",
  "admissionsTest",
  "languageRequirement",
  "restrictedEntry",
] as const;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const prune = args.includes("--prune");
const path = args.find((a) => !a.startsWith("--"));

if (!path) {
  console.error(
    "Usage: npx tsx scripts/ingest-requirements.ts [--dry-run] [--prune] <file.json>\n\n" +
      "  --dry-run  validate and report without writing anything\n" +
      "  --prune    after writing, delete rows for the universities in this file\n" +
      "             that this file no longer produces. Needed after a change to\n" +
      "             how names normalize, which moves a row's key and would\n" +
      "             otherwise leave the old one behind as a duplicate.",
  );
  process.exit(1);
}

function readRecords(file: string): unknown[] {
  const text = readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error(
      `\n  ${file} is not valid JSON: ${(error as Error).message}\n`,
    );
    process.exit(1);
  }
  // Accept either a bare array or an object wrapping one, since an agent asked
  // for "a JSON array" may still wrap it.
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    // `records` WINS over any other array, and that precedence is the whole
    // point rather than a nicety. The brief asks for an envelope carrying
    // `records` alongside `noSourceableData` and `unreached`, and "first array
    // in the object" would silently ingest the wrong list the moment an agent
    // emitted the keys in a different order — producing a confident, tiny,
    // completely wrong batch.
    const named = (parsed as Record<string, unknown>).records;
    if (Array.isArray(named)) return named;
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) return value;
    }
  }
  console.error(`\n  ${file} contains no array of records.\n`);
  process.exit(1);
}

async function main() {
  const records = readRecords(path!);
  console.log(`\nRead ${records.length} record(s) from ${path}`);
  if (dryRun) console.log("DRY RUN — nothing will be written.\n");
  else console.log("");

  const rejected: { identifier: string; errors: string[] }[] = [];
  const droppedRates: string[] = [];
  const writtenKeys = new Set<string>();
  const universesInFile = new Set<string>();
  let written = 0;
  let nullFields = 0;
  let totalFields = 0;
  const weakOnly: string[] = [];

  for (const raw of records) {
    const outcome = validateRecord(raw);
    if (!outcome.ok) {
      rejected.push({ identifier: outcome.identifier, errors: outcome.errors });
      continue;
    }

    const record = outcome.record;
    if (outcome.droppedAcceptanceRate) {
      droppedRates.push(`${record.university} — ${record.course}`);
    }
    const key = matchKey(record);
    if (!isUsableKey(key)) {
      rejected.push({
        identifier: `${record.university} — ${record.course}`,
        errors: [
          "University or course name carries no identifying words, so it cannot be matched to a student's target without risking a wrong match.",
        ],
      });
      continue;
    }

    writtenKeys.add(key);
    universesInFile.add(`${record.country}::${normalizeUniversity(record.university)}`);

    totalFields += REQUIREMENT_FIELDS.length;
    nullFields += REQUIREMENT_FIELDS.filter(
      (f) => !record.requirements[f],
    ).length;

    // Reported, never rejected. A record whose only sourced field is the
    // application route says "apply through UCAS" and nothing a student can
    // plan subjects around — 47% of the first batch was exactly this, almost
    // all of it UK, because an institution-wide admissions page states the
    // route and nothing course-specific. It is not FALSE, so refusing it would
    // destroy real rows on a re-ingest; it is thin, and thin data inflating a
    // coverage number is its own kind of wrong. So the count is surfaced here
    // and the brief tells researchers not to produce them.
    if (!DECISION_RELEVANT.some((f) => record.requirements[f])) {
      weakOnly.push(`${record.university} — ${record.course}`);
    }

    if (!dryRun) {
      const data = {
        matchKey: key,
        university: record.university,
        country: record.country,
        course: record.course,
        cycleYear: record.cycleYear,
        stale: record.stale,
        gatheredOn: new Date(`${record.gatheredOn}T00:00:00Z`),
        primarySourceUrl: record.primarySourceUrl,
        requirementsJson: JSON.stringify(record.requirements),
        acceptanceRatePercent: record.acceptanceRate?.percent ?? null,
        acceptanceRateScope: record.acceptanceRate?.scope ?? null,
        acceptanceRateSourceUrl: record.acceptanceRate?.sourceUrl ?? null,
      };
      // Upsert: a refresh of the same course should replace the old row rather
      // than accumulate a second one nothing can choose between.
      await prisma.courseRequirement.upsert({
        where: { matchKey: key },
        create: data,
        update: data,
      });
    }
    written += 1;
  }

  console.log(
    `  accepted : ${written}${dryRun ? " (would be written)" : ""}`,
  );
  console.log(`  rejected : ${rejected.length}`);
  if (totalFields > 0) {
    const pct = Math.round((nullFields / totalFields) * 100);
    console.log(
      `  unknown fields on accepted records: ${nullFields}/${totalFields} (${pct}%)`,
    );
    console.log(
      `  — a high number here is expected and good: those become "check the course page" rather than a guess.`,
    );
  }
  if (weakOnly.length > 0) {
    const pct = Math.round((weakOnly.length / Math.max(written, 1)) * 100);
    console.log(
      `  thin records (route/interview/work-experience only): ${weakOnly.length}/${written} (${pct}%)` +
        `\n  — these landed, but carry no grade, subject, test, language or quota` +
        `\n    requirement, so they add a card a student cannot plan around.`,
    );
  }
  if (droppedRates.length > 0) {
    console.log(
      `  acceptance rate dropped (record kept): ${droppedRates.length}` +
        ` — malformed internal-only field, not shown to students either way.`,
    );
  }

  await pruneSupersededRows(writtenKeys, universesInFile);

  if (rejected.length > 0) {
    console.log(`\nRejected records — none of these became data:\n`);
    for (const r of rejected) {
      console.log(`  ${r.identifier}`);
      for (const e of r.errors) console.log(`      ${e}`);
      console.log("");
    }
  }

  await prisma.$disconnect();
}

/**
 * Delete rows this file supersedes but no longer produces.
 *
 * Needed because a row is addressed by its matchKey, so ANY change to how a
 * name normalizes silently orphans every row written under the old spelling.
 * Stripping "(UCL)" out of university names moved 60 of the first 839 records;
 * without this, re-ingesting would have inserted 60 corrected rows and left the
 * 60 stale ones sitting alongside them — two records per course, differing only
 * in a key nothing would ever look up again.
 *
 * Scoped to the (country, university) pairs THIS FILE covers, rather than
 * deleting everything absent from it. A research wave is a slice, not the whole
 * table, and a --prune that treated a partial file as authoritative would wipe
 * every other university's data. Universities the file says nothing about are
 * not touched at all.
 */
async function pruneSupersededRows(
  writtenKeys: Set<string>,
  universesInFile: Set<string>,
) {
  if (!prune || dryRun || universesInFile.size === 0) return;

  const existing = await prisma.courseRequirement.findMany({
    select: { id: true, matchKey: true, university: true, country: true, course: true },
  });

  const doomed = existing.filter((row) => {
    // Recomputed from the DISPLAY name, not from the stored key — the stored
    // key is precisely the thing that may be in the old format.
    const canonical = `${row.country}::${normalizeUniversity(row.university)}`;
    return universesInFile.has(canonical) && !writtenKeys.has(row.matchKey);
  });

  if (doomed.length === 0) {
    console.log(`\n  prune: nothing superseded — every stored row for these`);
    console.log(`         universities is one this file still produces.`);
    return;
  }

  await prisma.courseRequirement.deleteMany({
    where: { id: { in: doomed.map((r) => r.id) } },
  });

  console.log(`\n  pruned : ${doomed.length} superseded row(s)`);
  for (const row of doomed.slice(0, 10)) {
    console.log(`           ${row.university} — ${row.course}`);
  }
  if (doomed.length > 10) console.log(`           ... and ${doomed.length - 10} more.`);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
