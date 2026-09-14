// Seed the test-prep edition's reference data.
//
//   npx tsx scripts/seed-testprep.ts                        # tests only
//   npx tsx scripts/seed-testprep.ts --dry-run data/testprep/policies.json
//   npx tsx scripts/seed-testprep.ts data/testprep/policies.json
//
// TWO KINDS OF DATA, AND THEY ARE NOT EQUALLY SAFE TO SHIP.
//
// The TEST TYPES are stable published facts — the SAT's two 200-800 sections,
// the ACT's four 1-36 ones — so they live in lib/testprep/test-types.ts and are
// upserted on every run. Without them a deployment cannot record a score at all.
//
// The SCHOOL POLICIES are a research output. Every middle-50% moves annually,
// and lib/testprep/target.ts opens by warning that a recalled percentile is a
// number produced "with total confidence and no source" that "a tutor will
// repeat to a parent". So policies are never hardcoded here: they come from a
// JSON file carrying its own sourceDataVersion, exactly as course requirements
// do in scripts/ingest-requirements.ts.
//
// A REJECTED RECORD DOES NOT ABORT THE BATCH. The useful outcome is "40 landed,
// 6 did not, here is exactly why" rather than a stack trace on the seventh.
// Anything rejected simply never becomes data, and a school with no policy row
// is dropped from derivation rather than guessed at — see loadPolicySchools.
//
// --dry-run validates and reports without touching the database. Run it first.
import { readFileSync } from "node:fs";
import { prisma } from "../lib/db";
import { normalizeUniversity } from "../lib/requirements/match";
import { SEED_TEST_TYPES } from "../lib/testprep/test-types";
import {
  percentileInRange,
  policyFileSchema,
  policyRecordSchema,
} from "../lib/testprep/policy-record";
import { testSectionSchemaSchema } from "../lib/validation/testprep";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--"));

async function seedTestTypes(): Promise<void> {
  console.log("Test types");
  for (const t of SEED_TEST_TYPES) {
    const sections = t.sectionSchema.sections
      .map((s) => `${s.name} ${s.min}-${s.max}`)
      .join(", ");
    console.log(`  ${t.code.padEnd(6)} ${t.compositeRule.padEnd(8)} ${sections}`);

    if (dryRun) continue;
    // Upserted on code, so a rerun is a no-op and a corrected schema lands
    // without orphaning the attempts already recorded against that row.
    const data = {
      name: t.name,
      sectionSchema: t.sectionSchema,
      compositeRule: t.compositeRule,
    };
    await prisma.testType.upsert({
      where: { code: t.code },
      create: { code: t.code, ...data },
      update: data,
    });
  }
  console.log(
    dryRun
      ? `  ${SEED_TEST_TYPES.length} would be written.\n`
      : `  ${SEED_TEST_TYPES.length} written.\n`,
  );
}

async function seedPolicies(path: string): Promise<void> {
  const parsedFile = policyFileSchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (!parsedFile.success) {
    console.error(
      `\n  ${path} is not a policy file: ${parsedFile.error.issues[0]?.message}\n` +
        `  Expected { "sourceDataVersion": "...", "records": [ ... ] }\n`,
    );
    process.exit(1);
  }
  const { sourceDataVersion, records } = parsedFile.data;

  console.log(`School policies — ${records.length} record(s) from ${path}`);
  console.log(`  sourceDataVersion: ${sourceDataVersion}\n`);

  // Every test the file may reference, with its composite range, so a
  // percentile can be checked against the scale it claims to be on.
  //
  // Seeded definitions FIRST, database rows over the top. Reading only the
  // database made --dry-run useless on a fresh one: nothing had been written
  // yet, so every record was rejected as "no test type with code SAT" and the
  // percentile checks never ran at all — which is the one thing a dry run is
  // for. The seeded set is what this script guarantees will exist by the time
  // any policy is written, so validating against it is honest rather than
  // optimistic; a row already in the database still wins, since a corrected
  // schema there is more current than the constant.
  const testTypes = new Map<string, { id: string; sectionSchema: unknown }>(
    SEED_TEST_TYPES.map((t) => [
      t.code,
      // No id until it is written. Only used when !dryRun, where the upsert in
      // seedTestTypes has already run and the database row below replaces this.
      { id: "", sectionSchema: t.sectionSchema as unknown },
    ]),
  );
  for (const row of await prisma.testType.findMany()) {
    testTypes.set(row.code, { id: row.id, sectionSchema: row.sectionSchema });
  }

  const rejected: { label: string; why: string }[] = [];
  let written = 0;

  for (const raw of records) {
    const parsed = policyRecordSchema.safeParse(raw);
    if (!parsed.success) {
      const r = raw as { school?: unknown; test?: unknown };
      rejected.push({
        label: `${String(r?.school ?? "?")} / ${String(r?.test ?? "?")}`,
        why: parsed.error.issues
          .map((i) => `${i.path.join(".") || "record"}: ${i.message}`)
          .join("; "),
      });
      continue;
    }
    const rec = parsed.data;
    const label = `${rec.school} / ${rec.test} / ${rec.cycle}`;

    const testType = testTypes.get(rec.test);
    if (!testType) {
      rejected.push({
        label,
        why: `no test type with code "${rec.test}" — seed tests first`,
      });
      continue;
    }

    // Percentiles against the scale they claim to be on. An ACT figure filed
    // under SAT is the likeliest research error and the hardest to spot later.
    const schema = testSectionSchemaSchema.safeParse(testType.sectionSchema);
    if (!schema.success) {
      rejected.push({ label, why: `test type "${rec.test}" has an unreadable schema` });
      continue;
    }
    const outOfRange = (["p25", "p50", "p75"] as const)
      .map((k) => [k, rec[k]] as const)
      .filter(
        ([, v]) => typeof v === "number" && !percentileInRange(v, schema.data),
      );
    if (outOfRange.length > 0) {
      rejected.push({
        label,
        why: outOfRange
          .map(
            ([k, v]) =>
              `${k}=${v} is outside ${rec.test}'s range ` +
              `${schema.data.compositeMin}-${schema.data.compositeMax}`,
          )
          .join("; "),
      });
      continue;
    }

    const region = rec.region?.trim() || null;

    if (!dryRun) {
      // FIND-THEN-WRITE RATHER THAN UPSERT, because region is nullable and that
      // breaks both halves of an upsert here. Prisma's compound-unique argument
      // will not take a null, and underneath it Postgres treats NULLs as
      // DISTINCT — so @@unique([name, country, region]) does not constrain two
      // rows that both have no region, and a second run of this seed would
      // quietly create a duplicate school rather than update the first.
      //
      // Safe as a sequential one-shot import; it is not safe under concurrency,
      // which a seed script is not.
      const found = await prisma.school.findFirst({
        where: { name: rec.school, country: rec.country, region },
        select: { id: true },
      });
      // The canonical form a student's free text is matched against. Written
      // here rather than derived at read time so the lookup stays an indexed
      // equality rather than a scan — see School.normalizedName.
      const normalizedName = normalizeUniversity(rec.school);
      const city = rec.city?.trim() || null;
      const school = found
        ? await prisma.school.update({
            where: { id: found.id },
            data: { city, normalizedName },
            select: { id: true },
          })
        : await prisma.school.create({
            data: {
              name: rec.school,
              country: rec.country,
              region,
              city,
              normalizedName,
            },
            select: { id: true },
          });

      const data = {
        policy: rec.policy,
        superscores: rec.superscores,
        scoreChoice: rec.scoreChoice,
        p25: rec.p25 ?? null,
        p50: rec.p50 ?? null,
        p75: rec.p75 ?? null,
        sourceDataVersion,
      };
      await prisma.schoolTestPolicy.upsert({
        where: {
          schoolId_testTypeId_effectiveCycle: {
            schoolId: school.id,
            testTypeId: testType.id,
            effectiveCycle: rec.cycle,
          },
        },
        create: {
          schoolId: school.id,
          testTypeId: testType.id,
          effectiveCycle: rec.cycle,
          ...data,
        },
        update: data,
      });
    }
    written += 1;
  }

  console.log(`  accepted : ${written}${dryRun ? " (would be written)" : ""}`);
  console.log(`  rejected : ${rejected.length}`);

  if (rejected.length > 0) {
    console.log(`\n  Rejected — none of these became data:\n`);
    for (const r of rejected.slice(0, 40)) {
      console.log(`    ${r.label}\n      ${r.why}`);
    }
    if (rejected.length > 40) {
      console.log(`    … and ${rejected.length - 40} more`);
    }
  }

  if (!dryRun && written > 0) {
    // Said rather than done. Recomputation touches every student resting on the
    // superseded cycle, and doing it silently inside a seed would make a data
    // import quietly rewrite targets families have already been told about.
    console.log(
      `\n  ${written} policies are live at sourceDataVersion ${sourceDataVersion}.\n` +
        `  Targets derived against an older version are now stale. To re-derive:\n` +
        `    recomputeForPolicyVersion in lib/testprep/derive.ts\n`,
    );
  }
}

async function main() {
  console.log(dryRun ? "\nDRY RUN — nothing will be written.\n" : "");

  await seedTestTypes();

  if (file) {
    await seedPolicies(file);
  } else {
    console.log(
      "No policy file given, so no school policies were touched.\n" +
        "  Without them every target derives to 'no school sets a bar', which is\n" +
        "  honest but empty. Pass a researched JSON to fill the catalogue:\n" +
        "    npx tsx scripts/seed-testprep.ts --dry-run data/testprep/policies.json\n",
    );
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
