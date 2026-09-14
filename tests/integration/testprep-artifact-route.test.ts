// Drafting a briefing, end to end, with the one model call faked.
//
// The route existed before anything called it; the button in
// app/(tutor)/students-testprep/[linkId]/draft-briefing.tsx is its first caller,
// and these are the first tests to run the route rather than the pure helpers
// underneath it.
//
// WHY THE MODEL IS MOCKED AND NOT CALLED. Everything this route guarantees is
// about what it does with the model's answer — it discards a briefing that drops
// a fired stopping notice, discards one that predicts a score, and records the
// cost either way. Those are exactly the answers a real model gives rarely and
// unpredictably, which makes them untestable against the live API and trivial to
// test against a stub. The stub returns what a model plausibly would; the
// assertions are all about the route.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { normalizeUniversity } from "@/lib/requirements/match";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("tp-artifact");
const d = hasTestDb ? describe : describe.skip;

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** What the stubbed model will return next. */
const reply = { current: {} as Record<string, unknown> };
const created = vi.fn();

vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...actual,
    getAnthropicClient: () => ({
      messages: {
        create: async (args: unknown) => {
          created(args);
          return {
            content: [{ type: "text", text: JSON.stringify(reply.current) }],
            usage: { input_tokens: 1200, output_tokens: 300 },
          };
        },
      },
    }),
  };
});

const { POST } = await import("@/app/api/tutor/artifact/route");
const { markBriefingForwardedAction } = await import("@/app/actions/testprep");

let seq = 0;
const uniq = () => `${runTag}-${seq++}`;

/** The bar every scenario here is measured against, unless it says otherwise. */
const BAR = 1400;

/**
 * A score 40 points under the bar — inside one standard SAT retake increment
 * (60 points), so sitting again could still clear it and NO stopping signal
 * fires.
 *
 * Worth naming, because it is easy to get wrong: 1200 against the same bar is a
 * stopping scenario, not a neutral one. A retake increment does not reach 1400
 * from there, so MARGINAL_VALUE_ZERO fires — and every test meaning to exercise
 * the ordinary path would be exercising the discard path instead, passing for
 * the wrong reason.
 */
const SCORE_WORTH_RETAKING = BAR - 40;

/** Clear of the bar by enough that ALL_TARGETS_MET fires. */
const CLEARS_THE_BAR = BAR + 120;

const NARRATIVE = {
  headline: "Two practice sittings this month, both in the same range.",
  summary:
    "Two practice tests in October, scoring 1420 and 1440. Best sections across all sittings are 730 Reading and Writing and 740 Math.",
  focusThisPeriod: "Math",
  stoppingNotice: null as string | null,
  whatThisDoesNotTellYou:
    "Practice tests are noisy and a single result is not a reliable reading. A test score is one threshold among several, and clearing it does not decide an admission. This covers test preparation only.",
};

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/tutor/artifact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** A tutor, a consenting student, a test, and a school that sets a bar. */
async function scenario(opts: { bar?: number; score?: number } = {}) {
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
      // The bar a school sets is its p50 — see schoolBar in lib/testprep/target.ts,
      // which reads p50 ?? p75 ?? p25. So p50 is the number these tests reason
      // about, and the other two only shape the band around it.
      p25: (opts.bar ?? BAR) - 100,
      p50: opts.bar ?? BAR,
      p75: (opts.bar ?? BAR) + 100,
      sourceDataVersion: `${runTag}/policies`,
    },
  });
  await prisma.targetSchool.create({
    data: { profileId: student.profile.id, name, country: "US" },
  });

  if (opts.score != null) {
    const half = opts.score / 2;
    await prisma.scoreAttempt.create({
      data: {
        studentUserId: student.user.id,
        testTypeId: testType.id,
        kind: "OFFICIAL",
        takenAt: new Date(Date.now() - 5 * 86_400_000),
        sectionScores: { "Reading and Writing": half, Math: half },
        composite: opts.score,
        enteredBy: "TUTOR",
        isVerified: false,
      },
    });
  }

  sessionUserId.current = tutor.user.id;
  return { tutor, student, link, testType, account };
}

d("drafting a progress briefing", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
    created.mockClear();
    reply.current = { ...NARRATIVE };
  });

  afterAll(async () => {
    await prisma.schoolTestPolicy.deleteMany({
      where: { sourceDataVersion: `${runTag}/policies` },
    });
    await prisma.school.deleteMany({ where: { region: `${runTag}-region` } });
    await prisma.testType.deleteMany({
      where: { code: { startsWith: `SAT-${runTag}` } },
    });
    await cleanupRun(runTag);
  });

  it("stores a briefing and hands it back to the tutor", async () => {
    const { student, link, testType } = await scenario({ score: SCORE_WORTH_RETAKING });

    const response = await post({ linkId: link.id, testTypeId: testType.id });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.narrative.headline).toBe(NARRATIVE.headline);

    const row = await prisma.progressArtifact.findFirstOrThrow({
      where: { studentUserId: student.user.id },
    });
    expect(row.error).toBeNull();
    // The computed numbers travel WITH the narrative, so a stored briefing can
    // be read back later without re-deriving anything.
    expect((row.narrative as Record<string, unknown>).computed).toBeTruthy();
  });

  it("never sends anything, so a fresh briefing is not marked forwarded", async () => {
    const { student, link, testType } = await scenario({ score: SCORE_WORTH_RETAKING });
    await post({ linkId: link.id, testTypeId: testType.id });

    const row = await prisma.progressArtifact.findFirstOrThrow({
      where: { studentUserId: student.user.id },
    });
    expect(row.sharedWithGuardianAt).toBeNull();
  });

  it("discards a briefing that drops a fired stopping notice, and keeps the cost", async () => {
    // The guarantee the whole product rests on. 1520 clears a 1400 bar, so a
    // signal is live — and the model returned a cheerful update with no mention
    // of it, which is exactly what an unconstrained model writes here.
    const { student, link, testType } = await scenario({ score: CLEARS_THE_BAR });
    reply.current = { ...NARRATIVE, stoppingNotice: null };

    const response = await post({ linkId: link.id, testTypeId: testType.id });
    expect(response.status).toBe(502);

    const row = await prisma.progressArtifact.findFirstOrThrow({
      where: { studentUserId: student.user.id },
    });
    expect(row.error).toMatch(/stopping signal/i);
    expect(row.narrative).toBeNull();
    // Discarded, not free. The tokens were spent before anything could reject
    // the answer, and a tutor reading their costs should see this run.
    expect(row.outputTokens).toBe(300);
    expect(row.costCents).toBeGreaterThan(0);
  });

  it("stores the briefing when the stopping notice is carried", async () => {
    const { student, link, testType } = await scenario({ score: CLEARS_THE_BAR });
    reply.current = {
      ...NARRATIVE,
      stoppingNotice:
        "The highest bar on this list is 1400 and the score is 1520, so more points would not change any outcome here.",
    };

    const response = await post({ linkId: link.id, testTypeId: testType.id });
    expect(response.status).toBe(200);

    const row = await prisma.progressArtifact.findFirstOrThrow({
      where: { studentUserId: student.user.id },
    });
    expect(row.error).toBeNull();
  });

  it("discards a briefing that predicts a future score", async () => {
    const { student, link, testType } = await scenario({ score: SCORE_WORTH_RETAKING });
    reply.current = {
      ...NARRATIVE,
      summary: `${NARRATIVE.summary} On track for 1500 by March.`,
    };

    const response = await post({ linkId: link.id, testTypeId: testType.id });
    expect(response.status).toBe(502);

    const row = await prisma.progressArtifact.findFirstOrThrow({
      where: { studentUserId: student.user.id },
    });
    expect(row.error).toMatch(/never predicts a future score/i);
    expect(row.narrative).toBeNull();
  });

  it("records a run whose answer could not be parsed at all", async () => {
    const { student, link, testType } = await scenario({ score: SCORE_WORTH_RETAKING });
    reply.current = { headline: "" };

    const response = await post({ linkId: link.id, testTypeId: testType.id });
    expect(response.status).toBe(502);

    const row = await prisma.progressArtifact.findFirstOrThrow({
      where: { studentUserId: student.user.id },
    });
    expect(row.error).toMatch(/could not read/i);
    expect(row.inputTokens).toBe(1200);
  });

  it("will not draft against a link that is not this tutor's", async () => {
    // A link id arrives in a request body. It is a claim to check, never an
    // instruction to follow.
    const mine = await scenario({ score: SCORE_WORTH_RETAKING });
    const theirs = await scenario({ score: SCORE_WORTH_RETAKING });
    sessionUserId.current = mine.tutor.user.id;

    const response = await post({
      linkId: theirs.link.id,
      testTypeId: mine.testType.id,
    });

    expect(response.status).toBe(404);
    expect(
      await prisma.progressArtifact.count({
        where: { studentUserId: theirs.student.user.id },
      }),
    ).toBe(0);
    // And no tokens were spent finding that out.
    expect(created).not.toHaveBeenCalled();
  });

  it("will not draft against a link whose guardian has not agreed", async () => {
    const { student, link, testType } = await scenario({ score: SCORE_WORTH_RETAKING });
    await prisma.caseloadLink.update({
      where: { id: link.id },
      data: { guardianConsentAt: null, status: "PENDING" },
    });

    const response = await post({ linkId: link.id, testTypeId: testType.id });

    expect(response.status).toBe(404);
    expect(
      await prisma.progressArtifact.count({
        where: { studentUserId: student.user.id },
      }),
    ).toBe(0);
    expect(created).not.toHaveBeenCalled();
  });

  it("logs the draft as a read of the student's data", async () => {
    // Drafting reads scores and targets. It is a read like any other and is
    // logged as one, so the student's own access page shows it.
    const { student, link, testType } = await scenario({ score: SCORE_WORTH_RETAKING });
    await post({ linkId: link.id, testTypeId: testType.id });

    const reads = await prisma.counselorReadLog.findMany({
      where: { caseloadLinkId: link.id },
    });
    expect(reads.map((r) => r.surface)).toContain("tutor.artifact");
    expect(student.user.id).toBeTruthy();
  });
});

d("marking a briefing as forwarded", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
    created.mockClear();
    reply.current = { ...NARRATIVE };
  });

  afterAll(async () => {
    await prisma.schoolTestPolicy.deleteMany({
      where: { sourceDataVersion: `${runTag}/policies` },
    });
    await prisma.school.deleteMany({ where: { region: `${runTag}-region` } });
    await prisma.testType.deleteMany({
      where: { code: { startsWith: `SAT-${runTag}` } },
    });
    await cleanupRun(runTag);
  });

  function form(artifactId: string): FormData {
    const fd = new FormData();
    fd.append("artifactId", artifactId);
    return fd;
  }

  /** A stored briefing belonging to a tutor, drafted through the real route. */
  async function briefing(opts: { score?: number } = {}) {
    const s = await scenario({ score: opts.score ?? SCORE_WORTH_RETAKING });
    await post({ linkId: s.link.id, testTypeId: s.testType.id });
    const row = await prisma.progressArtifact.findFirstOrThrow({
      where: { studentUserId: s.student.user.id },
    });
    return { ...s, artifact: row };
  }

  it("records the date, and takes it back on a second press", async () => {
    // It toggles because it is the tutor's own bookkeeping about something they
    // did in their email client, not a record of anyone's consent.
    const { artifact } = await briefing();

    expect((await markBriefingForwardedAction({}, form(artifact.id))).ok).toBe(true);
    let row = await prisma.progressArtifact.findUniqueOrThrow({
      where: { id: artifact.id },
    });
    expect(row.sharedWithGuardianAt).toBeInstanceOf(Date);

    expect((await markBriefingForwardedAction({}, form(artifact.id))).ok).toBe(true);
    row = await prisma.progressArtifact.findUniqueOrThrow({
      where: { id: artifact.id },
    });
    expect(row.sharedWithGuardianAt).toBeNull();
  });

  it("leaves the generated body alone", async () => {
    // The column this action writes is next to the one it must never touch.
    const { artifact } = await briefing();
    await markBriefingForwardedAction({}, form(artifact.id));

    const row = await prisma.progressArtifact.findUniqueOrThrow({
      where: { id: artifact.id },
    });
    expect(row.narrative).toEqual(artifact.narrative);
  });

  it("refuses a discarded run, which has nothing to forward", async () => {
    // A row reading "forwarded" against a run that produced no briefing is a
    // false statement about what this tutor did.
    reply.current = { ...NARRATIVE, summary: `${NARRATIVE.summary} On track for 1500.` };
    const s = await scenario({ score: SCORE_WORTH_RETAKING });
    await post({ linkId: s.link.id, testTypeId: s.testType.id });
    const failed = await prisma.progressArtifact.findFirstOrThrow({
      where: { studentUserId: s.student.user.id },
    });
    expect(failed.error).toBeTruthy();

    const result = await markBriefingForwardedAction({}, form(failed.id));

    expect(result.error).toMatch(/discarded/i);
    expect(
      (await prisma.progressArtifact.findUniqueOrThrow({ where: { id: failed.id } }))
        .sharedWithGuardianAt,
    ).toBeNull();
  });

  it("will not mark another tutor's briefing", async () => {
    const theirs = await briefing();
    const mine = await scenario({ score: SCORE_WORTH_RETAKING });
    sessionUserId.current = mine.tutor.user.id;

    const result = await markBriefingForwardedAction({}, form(theirs.artifact.id));

    expect(result.error).toMatch(/not found/i);
    expect(
      (
        await prisma.progressArtifact.findUniqueOrThrow({
          where: { id: theirs.artifact.id },
        })
      ).sharedWithGuardianAt,
    ).toBeNull();
  });
});
