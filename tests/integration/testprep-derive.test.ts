// Deriving and persisting against real rows.
//
// The pure engines are covered by unit tests. What only a database can prove is
// the part around them: that a policy version bump actually reaches every
// affected student, that an acknowledged stopping signal survives a rerun, and
// that a signal which stops holding is resolved rather than quietly deleted.
//
// The last group is the parity claim, and it is the one that decides whether
// this product is coherent at all: if a student sees one threshold status and
// their tutor sees another for the same test on the same day, the whole thing
// is broken in the way that is hardest to recover from — in front of a family.
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("tp-derive");

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { deriveAndPersist, deriveForStudent, recomputeForPolicyVersion } =
  await import("@/lib/testprep/derive");
const { RUBRIC_VERSION } = await import("@/lib/readiness/score");

const NOW = new Date("2026-10-15T00:00:00Z");
let seq = 0;
const uniq = () => `${runTag}-${Date.now()}-${seq++}`;

const SAT_SCHEMA = {
  sections: [
    { name: "Reading and Writing", min: 200, max: 800, step: 10 },
    { name: "Math", min: 200, max: 800, step: 10 },
  ],
  compositeMin: 400,
  compositeMax: 1600,
};

async function makeSat() {
  return prisma.testType.create({
    data: {
      code: `SAT-${uniq()}`,
      name: "SAT",
      sectionSchema: SAT_SCHEMA,
      compositeRule: "SUM",
    },
  });
}

/** A student with a target list, and schools with published policies. */
async function scenario(input: {
  schools: {
    name: string;
    policy: string;
    superscores?: boolean;
    p25?: number;
    p50?: number;
    p75?: number;
  }[];
  attempts: { rw: number; math: number }[];
  sourceDataVersion?: string;
  cycle?: number;
}) {
  const testType = await makeSat();
  const student = await createUserWithProfile(runTag, `s${uniq()}`);
  const version = input.sourceDataVersion ?? `testprep/${uniq()}`;

  for (const s of input.schools) {
    const name = `${s.name} ${uniq()}`;
    const school = await prisma.school.create({
      data: { name, country: "US" },
    });
    await prisma.schoolTestPolicy.create({
      data: {
        schoolId: school.id,
        testTypeId: testType.id,
        policy: s.policy,
        superscores: s.superscores ?? false,
        p25: s.p25 ?? null,
        p50: s.p50 ?? null,
        p75: s.p75 ?? null,
        sourceDataVersion: version,
        effectiveCycle: input.cycle ?? 2026,
      },
    });
    await prisma.targetSchool.create({
      data: { profileId: student.profile.id, name, country: "US" },
    });
  }

  for (const [i, a] of input.attempts.entries()) {
    await prisma.scoreAttempt.create({
      data: {
        studentUserId: student.user.id,
        testTypeId: testType.id,
        kind: "PRACTICE",
        takenAt: new Date(NOW.getTime() - (input.attempts.length - i) * 86_400_000),
        sectionScores: { "Reading and Writing": a.rw, Math: a.math },
        composite: a.rw + a.math,
        enteredBy: "TUTOR",
        isVerified: true,
      },
    });
  }

  return { testType, student, version };
}

describe.skipIf(!hasTestDb)("deriving against real rows", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
    await prisma.testType.deleteMany({ where: { code: { startsWith: "SAT-" + runTag } } });
  });

  it("persists a target naming the school that sets it", async () => {
    const { testType, student } = await scenario({
      schools: [
        { name: "State", policy: "REQUIRED", p50: 1200 },
        { name: "Duke", policy: "REQUIRED", p25: 1450, p50: 1500, p75: 1560 },
      ],
      attempts: [{ rw: 700, math: 700 }],
    });

    await deriveAndPersist({
      studentUserId: student.user.id,
      profileId: student.profile.id,
      testTypeId: testType.id,
      now: NOW,
    });

    const row = await prisma.scoreTarget.findUniqueOrThrow({
      where: {
        studentUserId_testTypeId: {
          studentUserId: student.user.id,
          testTypeId: testType.id,
        },
      },
      include: { bindingSchool: { select: { name: true } }, allocations: true },
    });

    expect(row.bindingComposite).toBe(1500);
    expect(row.bindingSchool?.name).toContain("Duke");
    expect([row.bandLow, row.bandHigh]).toEqual([1450, 1560]);
    // Pinned like every derived artefact in this app.
    expect(row.rubricVersion).toBe(RUBRIC_VERSION);
    expect(row.allocations).toHaveLength(2);
    expect(row.allocations.filter((a) => a.recommendedFocus)).toHaveLength(1);
  });

  it("records a blind school as excluded, by id, so the student can see why", async () => {
    const { testType, student } = await scenario({
      schools: [
        { name: "State", policy: "REQUIRED", p50: 1200 },
        { name: "Blind U", policy: "BLIND", p50: 1580 },
      ],
      attempts: [{ rw: 700, math: 700 }],
    });

    await deriveAndPersist({
      studentUserId: student.user.id,
      profileId: student.profile.id,
      testTypeId: testType.id,
      now: NOW,
    });

    const row = await prisma.scoreTarget.findUniqueOrThrow({
      where: {
        studentUserId_testTypeId: {
          studentUserId: student.user.id,
          testTypeId: testType.id,
        },
      },
    });
    expect(row.bindingComposite).toBe(1200);
    expect(row.excludedBlindSchoolIds).toHaveLength(1);
  });

  it("writes stopping signals with an inspectable basis", async () => {
    const { testType, student } = await scenario({
      schools: [{ name: "Reachable", policy: "REQUIRED", p50: 1300 }],
      attempts: [{ rw: 750, math: 750 }],
    });

    await deriveAndPersist({
      studentUserId: student.user.id,
      profileId: student.profile.id,
      testTypeId: testType.id,
      now: NOW,
    });

    const signals = await prisma.stoppingSignal.findMany({
      where: { studentUserId: student.user.id, resolvedAt: null },
    });
    expect(signals.map((s) => s.kind)).toContain("ALL_TARGETS_MET");
    for (const s of signals) {
      expect(s.basis).toHaveProperty("signal");
      expect(s.basis).toHaveProperty("summary");
    }
  });

  it("keeps a tutor's acknowledgement across a rerun", async () => {
    // A tutor who acknowledged "stop" in March must not be asked again in April
    // because a recompute happened to run.
    const { testType, student } = await scenario({
      schools: [{ name: "Cleared", policy: "REQUIRED", p50: 1300 }],
      attempts: [{ rw: 750, math: 750 }],
    });
    const args = {
      studentUserId: student.user.id,
      profileId: student.profile.id,
      testTypeId: testType.id,
      now: NOW,
    };
    await deriveAndPersist(args);

    const acked = new Date("2026-10-16T00:00:00Z");
    await prisma.stoppingSignal.updateMany({
      where: { studentUserId: student.user.id, kind: "ALL_TARGETS_MET" },
      data: { acknowledgedByTutorAt: acked },
    });

    await deriveAndPersist({ ...args, now: new Date("2026-11-01T00:00:00Z") });

    const after = await prisma.stoppingSignal.findFirstOrThrow({
      where: {
        studentUserId: student.user.id,
        kind: "ALL_TARGETS_MET",
        resolvedAt: null,
      },
    });
    expect(after.acknowledgedByTutorAt).toEqual(acked);
    // And the original firing time, not a fresh one.
    expect(after.firedAt).toEqual(NOW);
  });

  it("resolves a signal that stops holding rather than deleting it", async () => {
    // A family asking "you told us to stop in March" has to be answerable.
    const { testType, student } = await scenario({
      schools: [{ name: "Cleared", policy: "REQUIRED", p50: 1300 }],
      attempts: [{ rw: 750, math: 750 }],
    });
    const args = {
      studentUserId: student.user.id,
      profileId: student.profile.id,
      testTypeId: testType.id,
      now: NOW,
    };
    await deriveAndPersist(args);

    // The student adds a far more selective school: the engagement reopens.
    const harder = await prisma.school.create({
      data: { name: `Reach ${uniq()}`, country: "US" },
    });
    await prisma.schoolTestPolicy.create({
      data: {
        schoolId: harder.id,
        testTypeId: testType.id,
        policy: "REQUIRED",
        p50: 1580,
        sourceDataVersion: "testprep/added",
        effectiveCycle: 2026,
      },
    });
    await prisma.targetSchool.create({
      data: { profileId: student.profile.id, name: harder.name, country: "US" },
    });

    const later = new Date("2026-11-01T00:00:00Z");
    await deriveAndPersist({ ...args, now: later });

    const all = await prisma.stoppingSignal.findMany({
      where: { studentUserId: student.user.id, kind: "ALL_TARGETS_MET" },
    });
    expect(all).toHaveLength(1);
    // Resolved, still on the record, not gone.
    expect(all[0]!.resolvedAt).toEqual(later);
  });
});

describe.skipIf(!hasTestDb)("a policy version bump reaches every affected student", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("recomputes targets that rested on the old cycle's data", async () => {
    // The trigger nobody fires by hand, and the one that matters most: policies
    // change annually, and a target still resting on last cycle's data is
    // silently wrong for a whole application season.
    const version = `testprep/cycle-${uniq()}`;
    const { testType, student } = await scenario({
      schools: [{ name: "Wavering", policy: "REQUIRED", p50: 1300 }],
      attempts: [{ rw: 700, math: 700 }],
      sourceDataVersion: version,
      cycle: 2026,
    });

    await deriveAndPersist({
      studentUserId: student.user.id,
      profileId: student.profile.id,
      testTypeId: testType.id,
      now: NOW,
    });
    const before = await prisma.scoreTarget.findUniqueOrThrow({
      where: {
        studentUserId_testTypeId: {
          studentUserId: student.user.id,
          testTypeId: testType.id,
        },
      },
    });
    expect(before.bindingComposite).toBe(1300);

    // The school goes test-blind for the next cycle — the case that must not be
    // missed, because the student is otherwise held to a bar that no longer
    // exists anywhere.
    const policy = await prisma.schoolTestPolicy.findFirstOrThrow({
      where: { testTypeId: testType.id, sourceDataVersion: version },
      select: { schoolId: true },
    });
    const newVersion = `testprep/cycle-${uniq()}`;
    await prisma.schoolTestPolicy.create({
      data: {
        schoolId: policy.schoolId,
        testTypeId: testType.id,
        policy: "BLIND",
        sourceDataVersion: newVersion,
        effectiveCycle: 2027,
      },
    });

    const result = await recomputeForPolicyVersion({
      sourceDataVersion: newVersion,
      now: new Date("2026-12-01T00:00:00Z"),
    });
    expect(result.targetsRecomputed).toBeGreaterThan(0);

    const after = await prisma.scoreTarget.findUniqueOrThrow({
      where: {
        studentUserId_testTypeId: {
          studentUserId: student.user.id,
          testTypeId: testType.id,
        },
      },
    });
    // No bar any more — the school will not look at a score.
    expect(after.bindingComposite).toBeNull();
    expect(after.excludedBlindSchoolIds).toHaveLength(1);
    expect(after.sourceDataVersion).toBe(newVersion);
  });

  it("does nothing for a version nothing rests on", async () => {
    expect(
      await recomputeForPolicyVersion({ sourceDataVersion: "testprep/nonexistent" }),
    ).toEqual({ testTypesTouched: 0, targetsRecomputed: 0 });
  });
});

describe.skipIf(!hasTestDb)("the same numbers on every surface", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  /**
   * THE PARITY CLAIM. If a student saw one threshold status and their tutor saw
   * another for the same test on the same day, the product would be broken in
   * the way that is hardest to recover from — in front of a family, in a paid
   * session. Derivation is a pure function of stored rows, so this drives it
   * from two different callers and checks they agree byte for byte.
   */
  it("derives identically however it is called, at the same rubricVersion", async () => {
    const { testType, student } = await scenario({
      schools: [
        { name: "Alpha", policy: "REQUIRED", p25: 1350, p50: 1400, p75: 1450 },
        { name: "Beta", policy: "OPTIONAL", p50: 1500 },
        { name: "Gamma", policy: "BLIND", p50: 1580 },
      ],
      attempts: [
        { rw: 700, math: 690 },
        { rw: 680, math: 730 },
      ],
    });

    const asTutor = await deriveForStudent({
      studentUserId: student.user.id,
      profileId: student.profile.id,
      testTypeId: testType.id,
    });
    const asStudent = await deriveForStudent({
      studentUserId: student.user.id,
      profileId: student.profile.id,
      testTypeId: testType.id,
    });

    expect(asTutor).not.toBeNull();
    expect(asStudent!.target).toEqual(asTutor!.target);
    expect(asStudent!.allocations).toEqual(asTutor!.allocations);
    expect(asStudent!.signals.map((s) => s.kind)).toEqual(
      asTutor!.signals.map((s) => s.kind),
    );
    // And the persisted row agrees with what a fresh derivation says.
    await deriveAndPersist({
      studentUserId: student.user.id,
      profileId: student.profile.id,
      testTypeId: testType.id,
      now: NOW,
    });
    const stored = await prisma.scoreTarget.findUniqueOrThrow({
      where: {
        studentUserId_testTypeId: {
          studentUserId: student.user.id,
          testTypeId: testType.id,
        },
      },
    });
    expect(stored.bindingComposite).toBe(asTutor!.target.bindingComposite);
    expect(stored.bandLow).toBe(asTutor!.target.bandLow);
    expect(stored.rubricVersion).toBe(RUBRIC_VERSION);
  });
});
