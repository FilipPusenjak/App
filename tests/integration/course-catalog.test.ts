// The course list offered for a university, against a real database.
//
// This feeds a picker whose entire purpose is that the student ends up with a
// string the lookup can match EXACTLY. So the property that matters is not
// "returns some courses" — it is that what comes out of here goes back into
// findRequirementsForTargets and hits.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { coursesForUniversity } from "@/lib/requirements/catalog";
import { findRequirementsForTargets } from "@/lib/requirements/lookup";
import { matchKey } from "@/lib/requirements/match";
import { hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("catalog");
const describeDb = hasTestDb ? describe : describe.skip;

async function seed(university: string, country: string, course: string) {
  const key = matchKey({ university, country, course });
  const data = {
    matchKey: key,
    university,
    country,
    course,
    cycleYear: new Date().getUTCFullYear() + 1,
    stale: false,
    gatheredOn: new Date(),
    primarySourceUrl: "https://www.example.ac.uk/x",
    requirementsJson: JSON.stringify({
      gradeRequirement: {
        value: "A*AA",
        quote: "The typical offer for this course is A*AA at A Level.",
        sourceUrl: "https://www.example.ac.uk/x",
      },
    }),
  };
  await prisma.courseRequirement.upsert({
    where: { matchKey: key },
    create: data,
    update: data,
  });
}

// Names carry the run tag so this file cannot collide with another's rows.
const UNI = `${runTag} University College Somewhere (UCS)`;
const OTHER = `${runTag} Somewhere State University`;

describeDb("courses offered for a university", () => {
  beforeAll(async () => {
    await seed(UNI, "GB", "Computer Science B.A. (Hons)/M.Eng.");
    await seed(UNI, "GB", "Medicine (A100)");
    await seed(UNI, "GB", "Architecture B.A.");
    await seed(OTHER, "US", "Economics B.S.");
  });

  afterAll(async () => {
    await prisma.courseRequirement.deleteMany({
      where: { university: { startsWith: runTag } },
    });
  });

  it("lists what we hold, and nothing else", async () => {
    const courses = await coursesForUniversity(UNI, "GB");
    expect(courses).toHaveLength(3);
    expect(courses).toContain("Medicine (A100)");
    expect(courses).not.toContain("Economics B.S.");
  });

  it("returns names EXACTLY as stored", async () => {
    // The whole point. A prettied-up name would reintroduce the mismatch the
    // picker exists to remove.
    const courses = await coursesForUniversity(UNI, "GB");
    expect(courses).toContain("Computer Science B.A. (Hons)/M.Eng.");
  });

  it("feeds straight back into a successful lookup", async () => {
    // The property the feature reduces to: pick from the list, get the data.
    const courses = await coursesForUniversity(UNI, "GB");
    for (const course of courses) {
      const found = await findRequirementsForTargets([
        { name: UNI, country: "GB", course },
      ]);
      expect(found).toHaveLength(1);
    }
  });

  it("works from the acronym, not just the full name", async () => {
    // A picker that only appears once the name is already perfect is useless.
    const full = await coursesForUniversity(
      `${runTag} University College Somewhere`,
      "GB",
    );
    expect(full).toHaveLength(3);
  });

  it("does not cross a country", async () => {
    expect(await coursesForUniversity(UNI, "US")).toEqual([]);
    expect(await coursesForUniversity(OTHER, "GB")).toEqual([]);
  });

  it("returns nothing for a university we have never researched", async () => {
    expect(await coursesForUniversity("Nowhere University", "GB")).toEqual([]);
  });

  it("returns nothing rather than guessing on junk input", async () => {
    expect(await coursesForUniversity("", "GB")).toEqual([]);
    expect(await coursesForUniversity(UNI, "")).toEqual([]);
    expect(await coursesForUniversity(UNI, "GBR")).toEqual([]);
  });
});

describeDb("a university name that reaches two institutions", () => {
  const ambiguous = makeRunTag("catambig");

  beforeAll(async () => {
    await seed(`University of ${ambiguous}`, "GB", "History B.A.");
    await seed(`${ambiguous} University`, "GB", "Physics B.Sc.");
  });

  afterAll(async () => {
    await prisma.courseRequirement.deleteMany({
      where: { university: { contains: ambiguous } },
    });
  });

  it("offers NOTHING rather than a merged list", async () => {
    // A merged list invites the student to pick a course from the wrong school
    // — creating by hand exactly the wrong match the matcher refuses to make.
    expect(await coursesForUniversity(ambiguous, "GB")).toEqual([]);
  });
});
