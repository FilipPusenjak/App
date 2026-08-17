// Looking up requirements for a student's targets, against a real database.
//
// The unit tests cover which candidate keys a typed name produces. This covers
// what happens when those keys meet actual rows — in particular the rule that
// makes the expansion safe: a name that could mean two institutions resolves to
// NEITHER, not to whichever the query returned first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { findRequirementsForTargets } from "@/lib/requirements/lookup";
import { matchKey } from "@/lib/requirements/match";
import { hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("reqlookup");
const describeDb = hasTestDb ? describe : describe.skip;

const fact = (value: string) => ({
  value,
  quote: `The typical offer is ${value} for this course.`,
  sourceUrl: "https://www.example.ac.uk/courses/x",
});

async function seed(university: string, country: string, course: string) {
  const key = matchKey({ university, country, course });
  const data = {
    matchKey: key,
    university: `${runTag} ${university}`,
    country,
    course,
    cycleYear: new Date().getUTCFullYear() + 1,
    stale: false,
    gatheredOn: new Date(),
    primarySourceUrl: "https://www.example.ac.uk/courses/x",
    requirementsJson: JSON.stringify({ gradeRequirement: fact("A*AA") }),
  };
  await prisma.courseRequirement.upsert({
    where: { matchKey: key },
    create: data,
    update: data,
  });
  return key;
}

const seededKeys: string[] = [];

describeDb("finding requirements for a target", () => {
  beforeAll(async () => {
    seededKeys.push(
      await seed("University College London (UCL)", "GB", "Law LLB"),
      await seed("University of Cambridge", "GB", "Computer Science"),
      await seed("Yale University", "US", "Statistics"),
      await seed("University of California, Los Angeles", "US", "Economics"),
    );
  });

  afterAll(async () => {
    await prisma.courseRequirement.deleteMany({
      where: { university: { startsWith: runTag } },
    });
  });

  const target = (name: string, country: string, course: string | null) => ({
    name,
    country,
    course,
  });

  it("matches a university written exactly as the record has it", async () => {
    const found = await findRequirementsForTargets([
      target("University of Cambridge", "GB", "Computer Science"),
    ]);
    expect(found).toHaveLength(1);
  });

  it("matches the plain name of a record that carries its own acronym", async () => {
    // The 60-record bug: stored as `university college london ucl`, so the
    // correct full name found nothing.
    const found = await findRequirementsForTargets([
      target("University College London", "GB", "Law LLB"),
    ]);
    expect(found).toHaveLength(1);
  });

  it("matches the acronym a student is far more likely to type", async () => {
    const found = await findRequirementsForTargets([
      target("UCL", "GB", "Law LLB"),
    ]);
    expect(found).toHaveLength(1);
  });

  it("matches a short form via the mechanical rewrite", async () => {
    const found = await findRequirementsForTargets([
      target("Cambridge", "GB", "Computer Science"),
      target("Yale", "US", "Statistics"),
    ]);
    expect(found).toHaveLength(2);
  });

  it("matches a curated alias", async () => {
    const found = await findRequirementsForTargets([
      target("UCLA", "US", "Economics"),
    ]);
    expect(found).toHaveLength(1);
  });

  it("labels the result with the name the STUDENT used", async () => {
    // The UI says "Cambridge" back to someone who wrote "Cambridge".
    const found = await findRequirementsForTargets([
      target("Cambridge", "GB", "Computer Science"),
    ]);
    expect(found[0]!.targetName).toBe("Cambridge");
  });

  it("still refuses to cross a country", async () => {
    const found = await findRequirementsForTargets([
      target("University of Cambridge", "US", "Computer Science"),
    ]);
    expect(found).toEqual([]);
  });

  it("still refuses a target with no course", async () => {
    const found = await findRequirementsForTargets([
      target("University of Cambridge", "GB", null),
    ]);
    expect(found).toEqual([]);
  });

  it("returns nothing for a course it has no data on", async () => {
    // The designed failure: the evaluation says "check the course page".
    const found = await findRequirementsForTargets([
      target("University of Cambridge", "GB", "Basket Weaving"),
    ]);
    expect(found).toEqual([]);
  });
});

describeDb("a name that could mean two institutions", () => {
  const ambiguousTag = makeRunTag("ambig");

  beforeAll(async () => {
    // Two DIFFERENT institutions that a single expanded name can reach:
    // "Example" -> "university example" and "example university".
    for (const [university, marker] of [
      ["University of Example", "one"],
      ["Example University", "two"],
    ] as const) {
      const key = matchKey({ university, country: "GB", course: "History" });
      const data = {
        matchKey: key,
        university: `${ambiguousTag} ${marker}`,
        country: "GB",
        course: "History",
        cycleYear: new Date().getUTCFullYear() + 1,
        stale: false,
        gatheredOn: new Date(),
        primarySourceUrl: "https://www.example.ac.uk/x",
        requirementsJson: JSON.stringify({ gradeRequirement: fact("AAA") }),
      };
      await prisma.courseRequirement.upsert({
        where: { matchKey: key },
        create: data,
        update: data,
      });
    }
  });

  afterAll(async () => {
    await prisma.courseRequirement.deleteMany({
      where: { university: { startsWith: ambiguousTag } },
    });
  });

  it("returns NEITHER rather than picking one", async () => {
    // The safety property the whole expansion rests on. Showing either record
    // would be a confident wrong answer; showing none is the behaviour the app
    // had before any of this existed.
    const found = await findRequirementsForTargets([
      { name: "Example", country: "GB", course: "History" },
    ]);
    expect(found).toEqual([]);
  });

  it("still resolves an unambiguous name in the same batch", async () => {
    // One bad target must not suppress the others.
    const key = await seed("University of Cambridge", "GB", "Philosophy");
    seededKeys.push(key);
    const found = await findRequirementsForTargets([
      { name: "Example", country: "GB", course: "History" },
      { name: "Cambridge", country: "GB", course: "Philosophy" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.targetName).toBe("Cambridge");
    await prisma.courseRequirement.deleteMany({ where: { matchKey: key } });
  });
});
