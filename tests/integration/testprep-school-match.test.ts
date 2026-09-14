// Turning what a student typed into the school whose policy sets their target.
//
// This is the join the whole test-prep edition rests on, and it used to be an
// exact string match on free text. A target school is whatever a student wrote
// — "MIT", "Cambridge", "Duke" — while the seeded catalogue holds one official
// name each, so almost nothing resolved.
//
// WHAT MAKES THAT FAILURE WORSE THAN A MISSING ROW: an unresolved school is
// dropped from derivation rather than guessed at, which is correct. But a
// student whose entire list is unresolved derives to "no school sets a bar",
// and a tutor reads that as "nothing left to clear" rather than as a lookup
// that found nothing. The product's central claim comes out inverted.
//
// So these tests are about a join, but what they are really protecting is that
// the stopping engine never says "you are done" because the data was missing.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { normalizeUniversity } from "@/lib/requirements/match";
import { loadPolicySchools } from "@/lib/testprep/derive";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("tp-match");
const d = hasTestDb ? describe : describe.skip;

const CYCLE = 2027;
const SOURCE = `${runTag}/policies`;

let seq = 0;
const uniq = () => `${runTag}-${seq++}`;

async function makeSat() {
  return prisma.testType.create({
    data: {
      code: `SAT-${uniq()}`,
      name: "SAT",
      sectionSchema: {
        sections: [
          { name: "Reading and Writing", min: 200, max: 800, step: 10 },
          { name: "Math", min: 200, max: 800, step: 10 },
        ],
        compositeMin: 400,
        compositeMax: 1600,
      },
      compositeRule: "SUM",
    },
  });
}

/** A catalogue school, written the way the seed writes one. */
async function seedSchool(name: string, country = "US") {
  return prisma.school.create({
    data: {
      name,
      country,
      region: `${runTag}-region`,
      normalizedName: normalizeUniversity(name),
    },
  });
}

async function seedPolicy(schoolId: string, testTypeId: string) {
  await prisma.schoolTestPolicy.create({
    data: {
      schoolId,
      testTypeId,
      effectiveCycle: CYCLE,
      policy: "REQUIRED",
      superscores: false,
      scoreChoice: false,
      p25: 1400,
      p50: 1500,
      p75: 1560,
      sourceDataVersion: SOURCE,
    },
  });
}

/** What a student typed, as a target on their own profile. */
async function typeTarget(profileId: string, name: string, country = "US") {
  await prisma.targetSchool.create({
    data: { profileId, name, country },
  });
}

d("a typed target finds its school", () => {
  let profileId = "";
  let testTypeId = "";

  beforeEach(async () => {
    await cleanupRun(runTag);
    await prisma.schoolTestPolicy.deleteMany({
      where: { sourceDataVersion: SOURCE },
    });
    await prisma.school.deleteMany({ where: { region: `${runTag}-region` } });

    const made = await createUserWithProfile(runTag, "student");
    profileId = made.profile.id;
    const sat = await makeSat();
    testTypeId = sat.id;
  });

  afterAll(async () => {
    await prisma.schoolTestPolicy.deleteMany({
      where: { sourceDataVersion: SOURCE },
    });
    await prisma.school.deleteMany({ where: { region: `${runTag}-region` } });
    await prisma.testType.deleteMany({ where: { code: { startsWith: `SAT-${runTag}` } } });
    await cleanupRun(runTag);
  });

  async function resolved() {
    const { schools } = await loadPolicySchools({
      profileId,
      testTypeId,
      cycle: CYCLE,
    });
    return schools.map((s) => s.schoolName);
  }

  it("matches the name written exactly as the catalogue holds it", async () => {
    const school = await seedSchool("Duke University");
    await seedPolicy(school.id, testTypeId);
    await typeTarget(profileId, "Duke University");

    expect(await resolved()).toEqual(["Duke University"]);
  });

  it("matches the short form a student is far likelier to type", async () => {
    // "Duke", not "Duke University". The single most common mismatch.
    const school = await seedSchool("Duke University");
    await seedPolicy(school.id, testTypeId);
    await typeTarget(profileId, "Duke");

    expect(await resolved()).toEqual(["Duke University"]);
  });

  it("matches the long form when the catalogue holds the short one", async () => {
    const school = await seedSchool("Cambridge", "GB");
    await seedPolicy(school.id, testTypeId);
    await typeTarget(profileId, "University of Cambridge", "GB");

    expect(await resolved()).toEqual(["Cambridge"]);
  });

  it("matches a curated acronym, which no mechanical rewrite would reach", async () => {
    // The case that motivated using the shared resolver rather than rolling a
    // second one here: "mit" reaches "massachusetts institute technology" only
    // through the curated alias table.
    const school = await seedSchool("Massachusetts Institute of Technology");
    await seedPolicy(school.id, testTypeId);
    await typeTarget(profileId, "MIT");

    expect(await resolved()).toEqual(["Massachusetts Institute of Technology"]);
  });

  it("ignores case and punctuation in what was typed", async () => {
    const school = await seedSchool("Johns Hopkins University");
    await seedPolicy(school.id, testTypeId);
    await typeTarget(profileId, "  johns hopkins  university ");

    expect(await resolved()).toEqual(["Johns Hopkins University"]);
  });

  it("does not match a school in another country", async () => {
    // A name alone is not unique globally, which is why country is part of the
    // match rather than a filter applied afterwards.
    const school = await seedSchool("Trinity College", "IE");
    await seedPolicy(school.id, testTypeId);
    await typeTarget(profileId, "Trinity College", "GB");

    expect(await resolved()).toEqual([]);
  });

  it("drops a school the catalogue has never heard of", async () => {
    // Dropped rather than guessed at. The alternative — assuming REQUIRED, or
    // inventing quartiles — puts a bar in front of a student that no university
    // ever stated.
    await typeTarget(profileId, "Not In The Catalogue College");

    expect(await resolved()).toEqual([]);
  });

  it("drops a catalogue school that has no policy for this test", async () => {
    await seedSchool("Policyless University");
    await typeTarget(profileId, "Policyless University");

    expect(await resolved()).toEqual([]);
  });

  it("carries the provenance the recomputation keys on", async () => {
    const school = await seedSchool("Duke University");
    await seedPolicy(school.id, testTypeId);
    await typeTarget(profileId, "Duke");

    const { sourceDataVersion } = await loadPolicySchools({
      profileId,
      testTypeId,
      cycle: CYCLE,
    });
    expect(sourceDataVersion).toBe(SOURCE);
  });

  it("resolves a whole list, not just the first that matches", async () => {
    for (const name of ["Duke University", "Johns Hopkins University"]) {
      const school = await seedSchool(name);
      await seedPolicy(school.id, testTypeId);
    }
    await typeTarget(profileId, "Duke");
    await typeTarget(profileId, "JHU");

    expect((await resolved()).sort()).toEqual([
      "Duke University",
      "Johns Hopkins University",
    ]);
  });

  it("finds nothing for a row written without a canonical name", async () => {
    // The lookup is an indexed equality on normalizedName, so a row written by
    // some future path that forgets to set it is invisible to matching rather
    // than wrongly matched. Invisible is the safe direction.
    const school = await prisma.school.create({
      data: { name: "Unnormalized College", country: "US", region: `${runTag}-region` },
    });
    await seedPolicy(school.id, testTypeId);
    await typeTarget(profileId, "Unnormalized College");

    expect(await resolved()).toEqual([]);
  });
});
