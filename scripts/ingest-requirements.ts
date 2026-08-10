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
import { isUsableKey, matchKey } from "../lib/requirements/match";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const path = args.find((a) => !a.startsWith("--"));

if (!path) {
  console.error(
    "Usage: npx tsx scripts/ingest-requirements.ts [--dry-run] <file.json>",
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
  let written = 0;
  let nullFields = 0;
  let totalFields = 0;

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

    totalFields += REQUIREMENT_FIELDS.length;
    nullFields += REQUIREMENT_FIELDS.filter(
      (f) => !record.requirements[f],
    ).length;

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
  if (droppedRates.length > 0) {
    console.log(
      `  acceptance rate dropped (record kept): ${droppedRates.length}` +
        ` — malformed internal-only field, not shown to students either way.`,
    );
  }

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

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
