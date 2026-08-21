// Running the engines against real rows, and persisting what they decide.
//
// The pure functions in target.ts, allocation.ts and stopping.ts know nothing
// about the database on purpose — they are the part that has to be provable.
// This is the part that feeds them and writes down the answer.
//
// RECOMPUTATION IS THE INTERESTING PART. A target is derived from three things
// that all move independently: the student's scores, their school list, and the
// schools' published policies. The third is the one that rots silently —
// policies change annually, and a student whose target still rests on last
// cycle's data is being aimed at a bar that may no longer exist. So the trigger
// list is explicit, and a policy version bump recomputes every target that
// touched it.
import { prisma } from "@/lib/db";
import { RUBRIC_VERSION } from "@/lib/readiness/score";
import {
  compositeRuleSchema,
  testSectionSchemaSchema,
  type CompositeRule,
  type TestPolicy,
  type TestSectionSchema,
} from "@/lib/validation/testprep";
import { bestSectionScores, type SectionScores } from "./composite";
import { deriveTarget, type PolicySchool, type DerivedTarget } from "./target";
import { allocateSections, type Allocation } from "./allocation";
import {
  evaluateStopping,
  standardRetakeIncrement,
  type FiredSignal,
} from "./stopping";

export type DeriveResult = {
  target: DerivedTarget;
  allocations: Allocation[];
  signals: FiredSignal[];
  best: SectionScores;
  rule: CompositeRule;
  schema: TestSectionSchema;
  sourceDataVersion: string;
};

/**
 * The cycle a target should be derived against.
 *
 * Admissions cycles run ahead of the calendar: a student applying in autumn
 * 2026 is in the 2027 cycle. Taking the latest cycle we hold data for, rather
 * than computing one from today's date, means a target rests on policies that
 * actually exist rather than on a cycle nobody has published yet.
 */
export async function latestCycleFor(testTypeId: string): Promise<number | null> {
  const row = await prisma.schoolTestPolicy.findFirst({
    where: { testTypeId },
    orderBy: { effectiveCycle: "desc" },
    select: { effectiveCycle: true },
  });
  return row?.effectiveCycle ?? null;
}

/**
 * Assemble a student's policy list: their target schools, joined to what each
 * one does with this test in the current cycle.
 *
 * A target school with no matching School row, or no policy for this test, is
 * dropped rather than guessed at. The alternative — assuming REQUIRED, or
 * inventing quartiles — would put a bar in front of a student that no
 * university ever stated.
 */
export async function loadPolicySchools(input: {
  profileId: string;
  testTypeId: string;
  cycle: number;
}): Promise<{ schools: PolicySchool[]; sourceDataVersion: string | null }> {
  const targets = await prisma.targetSchool.findMany({
    where: { profileId: input.profileId },
    select: { name: true, country: true },
  });
  if (targets.length === 0) return { schools: [], sourceDataVersion: null };

  // Resolved by name+country, the same pairing School is unique on.
  const schools = await prisma.school.findMany({
    where: {
      OR: targets.map((t) => ({ name: t.name, country: t.country })),
    },
    select: {
      id: true,
      name: true,
      testPolicies: {
        where: { testTypeId: input.testTypeId, effectiveCycle: input.cycle },
        select: {
          policy: true,
          superscores: true,
          scoreChoice: true,
          p25: true,
          p50: true,
          p75: true,
          effectiveCycle: true,
          sourceDataVersion: true,
        },
      },
    },
  });

  const resolved: PolicySchool[] = [];
  let sourceDataVersion: string | null = null;

  for (const school of schools) {
    const policy = school.testPolicies[0];
    if (!policy) continue;
    sourceDataVersion ??= policy.sourceDataVersion;
    resolved.push({
      schoolId: school.id,
      schoolName: school.name,
      policy: policy.policy as TestPolicy,
      superscores: policy.superscores,
      scoreChoice: policy.scoreChoice,
      p25: policy.p25,
      p50: policy.p50,
      p75: policy.p75,
      effectiveCycle: policy.effectiveCycle,
    });
  }

  return { schools: resolved, sourceDataVersion };
}

/**
 * Run the whole pure pipeline for one student and one test.
 *
 * Zero model calls, here and in everything it calls. The one place a reader
 * should check that claim is the import list at the top of this file.
 */
export async function deriveForStudent(input: {
  studentUserId: string;
  profileId: string;
  testTypeId: string;
}): Promise<DeriveResult | null> {
  const testType = await prisma.testType.findUnique({
    where: { id: input.testTypeId },
    select: { sectionSchema: true, compositeRule: true },
  });
  if (!testType) return null;

  const parsedSchema = testSectionSchemaSchema.safeParse(testType.sectionSchema);
  const parsedRule = compositeRuleSchema.safeParse(testType.compositeRule);
  // A malformed test type is dropped rather than half-read — deriving a target
  // from a section schema we could not validate would produce a number with no
  // defensible meaning.
  if (!parsedSchema.success || !parsedRule.success) return null;

  const schema = parsedSchema.data;
  const rule = parsedRule.data;

  const cycle = await latestCycleFor(input.testTypeId);
  const { schools, sourceDataVersion } = cycle
    ? await loadPolicySchools({
        profileId: input.profileId,
        testTypeId: input.testTypeId,
        cycle,
      })
    : { schools: [], sourceDataVersion: null };

  const attemptRows = await prisma.scoreAttempt.findMany({
    where: {
      studentUserId: input.studentUserId,
      testTypeId: input.testTypeId,
    },
    orderBy: { takenAt: "asc" },
    select: { sectionScores: true, composite: true },
  });
  const attempts = attemptRows.map((a) => ({
    sectionScores: (a.sectionScores ?? {}) as SectionScores,
    composite: a.composite,
  }));

  const target = deriveTarget({ schools, attempts, rule, schema });
  const best = bestSectionScores(attempts, schema);
  const allocations = allocateSections({ current: best, schema, rule });
  const signals = evaluateStopping({
    target,
    schools,
    attempts,
    allocations,
    rule,
    schema,
    retakeIncrement: standardRetakeIncrement(rule, schema),
  });

  return {
    target,
    allocations,
    signals,
    best,
    rule,
    schema,
    sourceDataVersion: sourceDataVersion ?? "testprep/unversioned",
  };
}

/**
 * Derive and persist, in one transaction.
 *
 * Signals are RECONCILED rather than replaced. A live signal that still holds
 * keeps its original firedAt and its acknowledgement — a tutor who acknowledged
 * "stop" in March should not be asked again in April because a rerun happened.
 * One that stops holding is resolved rather than deleted, so a family asking
 * "you told us to stop in March" can be answered from the record.
 */
export async function deriveAndPersist(input: {
  studentUserId: string;
  profileId: string;
  testTypeId: string;
  now?: Date;
}): Promise<DeriveResult | null> {
  const result = await deriveForStudent(input);
  if (!result) return null;
  const now = input.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    const targetRow = await tx.scoreTarget.upsert({
      where: {
        studentUserId_testTypeId: {
          studentUserId: input.studentUserId,
          testTypeId: input.testTypeId,
        },
      },
      create: {
        studentUserId: input.studentUserId,
        testTypeId: input.testTypeId,
        bindingComposite: result.target.bindingComposite,
        bindingSchoolId: result.target.bindingSchoolId,
        bandLow: result.target.bandLow,
        bandHigh: result.target.bandHigh,
        excludedBlindSchoolIds: result.target.excludedBlindSchoolIds,
        nonBindingOptionalSchoolIds: result.target.nonBindingOptionalSchoolIds,
        computedAt: now,
        rubricVersion: RUBRIC_VERSION,
        sourceDataVersion: result.sourceDataVersion,
      },
      update: {
        bindingComposite: result.target.bindingComposite,
        bindingSchoolId: result.target.bindingSchoolId,
        bandLow: result.target.bandLow,
        bandHigh: result.target.bandHigh,
        excludedBlindSchoolIds: result.target.excludedBlindSchoolIds,
        nonBindingOptionalSchoolIds: result.target.nonBindingOptionalSchoolIds,
        computedAt: now,
        rubricVersion: RUBRIC_VERSION,
        sourceDataVersion: result.sourceDataVersion,
      },
      select: { id: true },
    });

    // Allocations are a pure function of the current scores, carry no history
    // and no acknowledgement, so replacing them wholesale is correct.
    await tx.sectionAllocation.deleteMany({ where: { scoreTargetId: targetRow.id } });
    if (result.allocations.length > 0) {
      await tx.sectionAllocation.createMany({
        data: result.allocations.map((a) => ({
          scoreTargetId: targetRow.id,
          sectionName: a.sectionName,
          currentScore: a.currentScore,
          headroom: a.headroom,
          pointsPerUnitEffort: a.pointsPerUnitEffort,
          recommendedFocus: a.recommendedFocus,
        })),
      });
    }

    const live = await tx.stoppingSignal.findMany({
      where: {
        studentUserId: input.studentUserId,
        testTypeId: input.testTypeId,
        resolvedAt: null,
      },
      select: { id: true, kind: true },
    });
    const firedKinds = new Set(result.signals.map((s) => s.kind));

    // Gone: resolved, not deleted. The record of what was said, and when.
    const stale = live.filter((l) => !firedKinds.has(l.kind as never));
    if (stale.length > 0) {
      await tx.stoppingSignal.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { resolvedAt: now },
      });
    }

    // New: written. Still-holding: left alone, keeping firedAt and any
    // acknowledgement.
    const liveKinds = new Set(live.map((l) => l.kind));
    const fresh = result.signals.filter((s) => !liveKinds.has(s.kind));
    for (const signal of fresh) {
      await tx.stoppingSignal.create({
        data: {
          studentUserId: input.studentUserId,
          testTypeId: input.testTypeId,
          kind: signal.kind,
          firedAt: now,
          basis: { ...signal.basis, summary: signal.summary },
        },
      });
    }
  });

  return result;
}

/**
 * Recompute every target that rests on a policy version.
 *
 * The trigger nobody would think to fire manually, and the one that matters
 * most: policies change annually, and a target still derived from last cycle's
 * data is silently wrong for a whole application season. Called when a
 * SchoolTestPolicy batch lands.
 */
export async function recomputeForPolicyVersion(input: {
  sourceDataVersion: string;
  now?: Date;
}): Promise<{ testTypesTouched: number; targetsRecomputed: number }> {
  const policies = await prisma.schoolTestPolicy.findMany({
    where: { sourceDataVersion: input.sourceDataVersion },
    select: { schoolId: true, testTypeId: true },
  });
  if (policies.length === 0) return { testTypesTouched: 0, targetsRecomputed: 0 };

  const testTypeIds = [...new Set(policies.map((p) => p.testTypeId))];

  // Every student holding a target for an affected test. Deliberately broad:
  // narrowing to "students targeting one of the changed schools" would miss the
  // student whose binding school did not change but whose RANKING among schools
  // did, which is exactly the silent case.
  const targets = await prisma.scoreTarget.findMany({
    where: { testTypeId: { in: testTypeIds } },
    select: { studentUserId: true, testTypeId: true },
  });

  let recomputed = 0;
  for (const target of targets) {
    // The student's own profile — one account may hold several, and a target
    // belongs to the profile whose target list produced it.
    const profile = await prisma.profile.findFirst({
      where: { userId: target.studentUserId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!profile) continue;
    const done = await deriveAndPersist({
      studentUserId: target.studentUserId,
      profileId: profile.id,
      testTypeId: target.testTypeId,
      now: input.now,
    });
    if (done) recomputed += 1;
  }

  return { testTypesTouched: testTypeIds.length, targetsRecomputed: recomputed };
}
