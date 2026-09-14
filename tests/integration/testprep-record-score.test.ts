// Recording a sitting — the only way a score enters this product.
//
// The action existed before anything called it; the form in
// app/(tutor)/students-testprep/[linkId]/record-score.tsx is its first caller.
// These cover the two halves that matter.
//
// THE COMPOSITE IS COMPUTED, NEVER ACCEPTED. There is no composite field on the
// form on purpose: a typed one that disagreed with its own sections would be a
// number nobody could explain later, and it is the number that reaches a parent.
// Sections also have to be stored individually for superscoring to mean
// anything — a product that stored only "1450" could never work out what a
// school reading best-sections-per-sitting actually sees.
//
// AND IT RECOMPUTES. Recording is the one moment a tutor watches the engine run,
// and it is the point at which a student may cross into "you are done" — which
// they should be told in the session, not next month.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { normalizeUniversity } from "@/lib/requirements/match";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("tp-record");
const d = hasTestDb ? describe : describe.skip;

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { recordScoreAction } = await import("@/app/actions/testprep");

let seq = 0;
const uniq = () => `${runTag}-${seq++}`;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

/** A tutor, a consenting student, and a TEST_PREP_ONLY link between them. */
async function scenario(opts: { policyP75?: number } = {}) {
  const tutor = await createUserWithProfile(runTag, `tutor-${uniq()}`);
  const account = await prisma.counselorAccount.create({
    data: {
      userId: tutor.user.id,
      orgName: `Prep ${uniq()}`,
      type: "TEST_PREP_TUTOR",
    },
  });
  const student = await createUserWithProfile(runTag, `student-${uniq()}`);

  const now = new Date();
  const link = await prisma.caseloadLink.create({
    data: {
      counselorAccountId: account.id,
      studentUserId: student.user.id,
      studentProfileId: student.profile.id,
      invitedBy: "STUDENT",
      status: "ACTIVE",
      scope: "TEST_PREP_ONLY",
      studentConsentAt: now,
      guardianConsentAt: now,
      startedAt: now,
    },
  });

  const testType = await prisma.testType.create({
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

  if (opts.policyP75 != null) {
    const name = `Probe University ${uniq()}`;
    const school = await prisma.school.create({
      data: {
        name,
        country: "US",
        region: `${runTag}-region`,
        normalizedName: normalizeUniversity(name),
      },
    });
    await prisma.schoolTestPolicy.create({
      data: {
        schoolId: school.id,
        testTypeId: testType.id,
        effectiveCycle: 2027,
        policy: "REQUIRED",
        p75: opts.policyP75,
        sourceDataVersion: `${runTag}/policies`,
      },
    });
    await prisma.targetSchool.create({
      data: { profileId: student.profile.id, name, country: "US" },
    });
  }

  // Every action reads the session, so the tutor has to BE the caller.
  sessionUserId.current = tutor.user.id;
  return { tutor, student, link, testType };
}

d("recording a sitting", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
  });

  afterAll(async () => {
    await prisma.schoolTestPolicy.deleteMany({
      where: { sourceDataVersion: `${runTag}/policies` },
    });
    await prisma.school.deleteMany({ where: { region: `${runTag}-region` } });
    await prisma.testType.deleteMany({ where: { code: { startsWith: `SAT-${runTag}` } } });
    await cleanupRun(runTag);
  });

  it("computes the composite from the sections rather than taking one", async () => {
    const { student, link, testType } = await scenario();

    const result = await recordScoreAction(
      {},
      form({
        linkId: link.id,
        testTypeId: testType.id,
        kind: "OFFICIAL",
        takenAt: "2026-10-01",
        "section:Reading and Writing": "720",
        "section:Math": "760",
      }),
    );
    expect(result.ok).toBe(true);

    const attempt = await prisma.scoreAttempt.findFirstOrThrow({
      where: { studentUserId: student.user.id },
    });
    expect(attempt.composite).toBe(1480);
    // The sections survive individually, which is what makes superscoring
    // computable at all.
    expect(attempt.sectionScores).toEqual({
      "Reading and Writing": 720,
      Math: 760,
    });
  });

  it("marks a tutor-entered score unverified, because they saw no report", async () => {
    const { student, link, testType } = await scenario();

    await recordScoreAction(
      {},
      form({
        linkId: link.id,
        testTypeId: testType.id,
        kind: "PRACTICE",
        takenAt: "2026-10-01",
        "section:Reading and Writing": "600",
        "section:Math": "600",
      }),
    );

    const attempt = await prisma.scoreAttempt.findFirstOrThrow({
      where: { studentUserId: student.user.id },
    });
    expect(attempt.enteredBy).toBe("TUTOR");
    expect(attempt.isVerified).toBe(false);
  });

  it("refuses a section score outside the range the test allows", async () => {
    // A typo that reached the derivation would move a family's target.
    const { student, link, testType } = await scenario();

    const result = await recordScoreAction(
      {},
      form({
        linkId: link.id,
        testTypeId: testType.id,
        kind: "PRACTICE",
        takenAt: "2026-10-01",
        "section:Reading and Writing": "900",
        "section:Math": "600",
      }),
    );

    expect(result.error).toMatch(/between 200 and 800/i);
    expect(
      await prisma.scoreAttempt.count({ where: { studentUserId: student.user.id } }),
    ).toBe(0);
  });

  it("refuses a sitting with no sections at all", async () => {
    const { student, link, testType } = await scenario();

    const result = await recordScoreAction(
      {},
      form({
        linkId: link.id,
        testTypeId: testType.id,
        kind: "PRACTICE",
        takenAt: "2026-10-01",
      }),
    );

    expect(result.error).toMatch(/at least one section/i);
    expect(
      await prisma.scoreAttempt.count({ where: { studentUserId: student.user.id } }),
    ).toBe(0);
  });

  it("recomputes the target, so a crossing is known in the session", async () => {
    // The whole reason recording triggers derivation rather than waiting for a
    // nightly job: this is the moment a tutor finds out the work is done.
    const { student, link, testType } = await scenario({ policyP75: 1400 });

    await recordScoreAction(
      {},
      form({
        linkId: link.id,
        testTypeId: testType.id,
        kind: "OFFICIAL",
        takenAt: "2026-10-01",
        "section:Reading and Writing": "760",
        "section:Math": "760",
      }),
    );

    const target = await prisma.scoreTarget.findFirstOrThrow({
      where: { studentUserId: student.user.id, testTypeId: testType.id },
    });
    expect(target.bindingComposite).toBe(1400);

    // 1520 clears a 1400 bar, so the engine has something to say about stopping.
    const signals = await prisma.stoppingSignal.findMany({
      where: { studentUserId: student.user.id, resolvedAt: null },
    });
    expect(signals.map((s) => s.kind)).toContain("ALL_TARGETS_MET");
  });

  it("will not record against a link that is not this tutor's", async () => {
    // A link id arrives in a form. It is a claim to check, never an
    // instruction to follow.
    const mine = await scenario();
    const theirs = await scenario();
    // Act as the FIRST tutor against the SECOND tutor's link.
    sessionUserId.current = mine.tutor.user.id;

    const result = await recordScoreAction(
      {},
      form({
        linkId: theirs.link.id,
        testTypeId: mine.testType.id,
        kind: "PRACTICE",
        takenAt: "2026-10-01",
        "section:Reading and Writing": "600",
        "section:Math": "600",
      }),
    );

    expect(result.error).toMatch(/no access/i);
    expect(
      await prisma.scoreAttempt.count({
        where: { studentUserId: theirs.student.user.id },
      }),
    ).toBe(0);
  });

  it("will not record against a link whose guardian has not agreed", async () => {
    const { student, link, testType } = await scenario();
    await prisma.caseloadLink.update({
      where: { id: link.id },
      data: { guardianConsentAt: null, status: "PENDING" },
    });

    const result = await recordScoreAction(
      {},
      form({
        linkId: link.id,
        testTypeId: testType.id,
        kind: "PRACTICE",
        takenAt: "2026-10-01",
        "section:Reading and Writing": "600",
        "section:Math": "600",
      }),
    );

    expect(result.error).toMatch(/no access/i);
    expect(
      await prisma.scoreAttempt.count({ where: { studentUserId: student.user.id } }),
    ).toBe(0);
  });
});
