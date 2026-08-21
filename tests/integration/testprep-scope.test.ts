// TEST_PREP_ONLY: the narrowest scope in the product.
//
// The claim under test is not "the UI hides activities" — it is that the SELECT
// never asks for them. A scope enforced by a component survives until someone
// adds a JSON route or an export; a scope enforced by a WHERE clause survives
// whatever gets built next. So the last group here drives real Prisma reads
// against real rows and checks what actually comes back.
//
// The middle group is about the counselor helpers, which predate this scope and
// know nothing about it. They compute permissions from `academics`/`activities`
// flags that TEST_PREP_ONLY sets neither of, so they must FAIL CLOSED — asserted
// rather than assumed, because "an unhandled enum value happens to be safe" is
// exactly what stops being true after a refactor.
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("tp-scope");

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => {
    if (!sessionUserId.current) throw new Error("Not signed in.");
    return sessionUserId.current;
  },
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { scopedProfileInclude, scopedProfileSelectFields } = await import(
  "@/lib/counselor/access"
);
const {
  TUTOR_PROFILE_SELECT,
  findTutorLink,
  listTutorLinks,
  readTargetSchools,
  readStudentThroughTutorLink,
} = await import("@/lib/testprep/access");
const { LINK_SCOPES, SCOPE_MEANINGS } = await import("@/lib/validation/counselor");

const NOW = new Date("2026-10-15T00:00:00Z");

describe("the scope exists and is described to the student", () => {
  it("is one of the link scopes", () => {
    expect(LINK_SCOPES).toContain("TEST_PREP_ONLY");
  });

  it("tells the student plainly what it does and does not include", () => {
    const meaning = SCOPE_MEANINGS.TEST_PREP_ONLY;
    expect(meaning).toMatch(/test scores/i);
    expect(meaning).toMatch(/target schools/i);
    // A family granting this must be able to see that it excludes the rest.
    expect(meaning).toMatch(/not your/i);
  });
});

describe("the counselor helpers fail closed for it", () => {
  const include = scopedProfileInclude("TEST_PREP_ONLY");

  it("fetches no resume items", () => {
    // An impossible WHERE, not an omitted include — the rows never leave
    // Postgres rather than being dropped after they arrive.
    expect(include.resumeItems).toEqual({ where: { id: "" } });
  });

  it("fetches no legacy test scores through the counselor path", () => {
    // A tutor reads scores through ScoreAttempt, its own table with its own
    // access function. The profile's TestScore rows are not theirs.
    expect(include.testScores).toEqual({ where: { id: "" } });
  });

  it("fetches no target schools through the counselor path", () => {
    expect(include.targetSchools).toEqual({ where: { id: "" } });
  });

  it("selects no academic fields", () => {
    const fields = scopedProfileSelectFields("TEST_PREP_ONLY");
    expect(fields.gpa).toBe(false);
    expect(fields.gpaScale).toBe(false);
    expect(fields.curriculum).toBe(false);
  });
});

describe("the tutor's own profile allow-list", () => {
  /**
   * An ALLOW-list, checked as one. A deny-list would hand every column added to
   * Profile next year to a test-prep tutor the day it was created.
   */
  it("names exactly the fields a tutor needs and no others", () => {
    expect(Object.keys(TUTOR_PROFILE_SELECT).sort()).toEqual([
      "gradeLevel",
      "graduationYear",
      "id",
      "studentName",
    ]);
  });

  it("excludes every differentiation and academic input", () => {
    const forbidden = [
      "gpa",
      "gpaScale",
      "curriculum",
      "schoolContext",
      "intendedMajor",
      "careerGoal",
      "majorCategory",
    ];
    for (const field of forbidden) {
      expect({ field, present: field in TUTOR_PROFILE_SELECT }).toEqual({
        field,
        present: false,
      });
    }
  });

  it("requests nothing but true — no nested relation can ride along", () => {
    for (const value of Object.values(TUTOR_PROFILE_SELECT)) {
      expect(value).toBe(true);
    }
  });
});

describe.skipIf(!hasTestDb)("against real rows", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  async function tutorWithStudent(scope = "TEST_PREP_ONLY") {
    const tutor = await createUserWithProfile(runTag, `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`);
    const account = await prisma.counselorAccount.create({
      data: { userId: tutor.user.id, orgName: "Test Prep Co", type: "TEST_PREP_TUTOR" },
    });
    const student = await createUserWithProfile(
      runTag,
      `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    );
    // A profile carrying everything a tutor must NOT see.
    await prisma.profile.update({
      where: { id: student.profile.id },
      data: {
        studentName: "Priya Raman",
        gradeLevel: "Grade 11",
        gpa: 3.9,
        gpaScale: "4.0",
        curriculum: "ap",
        schoolContext: "Offers 12 APs, does not rank.",
        intendedMajor: "Physics",
        careerGoal: "Research",
      },
    });
    await prisma.resumeItem.create({
      data: { profileId: student.profile.id, type: "extracurricular", title: "Robotics captain" },
    });
    await prisma.targetSchool.create({
      data: { profileId: student.profile.id, name: "Duke", country: "US", notes: "Mum went here" },
    });

    const link = await prisma.caseloadLink.create({
      data: {
        counselorAccountId: account.id,
        studentUserId: student.user.id,
        studentProfileId: student.profile.id,
        invitedBy: "STUDENT",
        status: "ACTIVE",
        scope,
        studentConsentAt: NOW,
        guardianConsentAt: NOW,
        startedAt: NOW,
      },
    });
    sessionUserId.current = tutor.user.id;
    return { tutor, account, student, linkId: link.id };
  }

  it("returns only the four allowed profile fields, and no others", async () => {
    const { linkId } = await tutorWithStudent();
    const read = await readStudentThroughTutorLink({ linkId, surface: "student.detail" });
    expect(read).not.toBeNull();

    // The row that came back, checked by its KEYS — the differentiation inputs
    // are absent from the object, not merely falsy on it.
    expect(Object.keys(read!.profile).sort()).toEqual([
      "gradeLevel",
      "graduationYear",
      "id",
      "studentName",
    ]);
    const serialized = JSON.stringify(read!.profile);
    expect(serialized).not.toContain("3.9");
    expect(serialized).not.toContain("Physics");
    expect(serialized).not.toContain("Robotics");
  });

  it("never returns a target school's private notes", async () => {
    const { linkId } = await tutorWithStudent();
    const link = await findTutorLink(linkId);
    const targets = await readTargetSchools(link!);

    expect(targets.map((t) => t.name)).toEqual(["Duke"]);
    // Why a school matters to a student is not part of a test-prep engagement.
    expect(JSON.stringify(targets)).not.toContain("Mum went here");
    expect(targets[0]).not.toHaveProperty("notes");
  });

  it("refuses a link whose scope is anything wider", async () => {
    // A tutor holding a FULL link would be a counselor by another name, and the
    // whole argument for this product's narrower access is that it is real.
    const { linkId } = await tutorWithStudent("FULL");
    expect(await findTutorLink(linkId)).toBeNull();
    expect(await listTutorLinks()).toEqual([]);
  });

  it("still refuses when a consent is missing, like every other surface", async () => {
    const { linkId } = await tutorWithStudent();
    await prisma.caseloadLink.update({
      where: { id: linkId },
      data: { guardianConsentAt: null },
    });
    expect(await findTutorLink(linkId)).toBeNull();
  });

  it("logs the read where the student can see it", async () => {
    const { linkId, student } = await tutorWithStudent();
    await readStudentThroughTutorLink({ linkId, surface: "tutor.student" });

    const reads = await prisma.counselorReadLog.findMany({
      where: { studentProfileId: student.profile.id },
      select: { surface: true, scope: true },
    });
    expect(reads).toHaveLength(1);
    // The scope AS IT WAS at the time of the read.
    expect(reads[0]).toEqual({ surface: "tutor.student", scope: "TEST_PREP_ONLY" });
  });
});
