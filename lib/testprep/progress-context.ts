// Assembling what the artifact's one model call is given.
//
// Everything numeric in here is already decided by the pure engines. The model's
// entire job is to say it in English to a parent — it computes nothing, and the
// prompt tells it so repeatedly, because a model handed a score history and
// asked for a progress report will otherwise start doing arithmetic.
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { estimateInputTokens } from "@/lib/cost-budget";
import type { ReadableLink } from "@/lib/counselor/access";
import type { StoppingKind } from "@/lib/validation/testprep";
import { computeComposite, type SectionScores } from "./composite";
import { deriveForStudent } from "./derive";
import { targetStatus } from "./target";
import { retakeGuidance } from "./allocation";
import { compositeAsSchoolSeesIt } from "./composite";
import { handoffMessage, isEngagementComplete } from "./stopping";
import {
  buildProgressUserPrompt,
  type ProgressContext,
} from "@/lib/prompts/testprep/progress-v1";

/** Bounded on purpose. A month of sittings is a handful of rows. */
export const PROGRESS_TOKEN_BUDGET = 5000;

export type BuiltProgress = {
  text: string;
  estimatedTokens: number;
  context: ProgressContext;
  /** Kinds that fired, for the mandatory-notice check the route enforces. */
  firedKinds: StoppingKind[];
  rubricVersion: string;
  sourceDataVersion: string;
  /** Passed through to the artifact row so the parent's copy carries the facts. */
  computed: {
    startingComposite: number | null;
    currentComposite: number | null;
    bestSectionScores: SectionScores;
    bandLow: number | null;
    bandHigh: number | null;
    setBy: string | null;
    status: "GAP_REMAINS" | "IN_BAND" | "CLEARED";
  };
};

export async function buildProgressContext(input: {
  link: ReadableLink;
  testTypeId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<BuiltProgress | null> {
  const derived = await deriveForStudent({
    studentUserId: input.link.studentUserId,
    profileId: input.link.studentProfileId,
    testTypeId: input.testTypeId,
  });
  if (!derived) return null;

  const [profile, testType, allAttempts, previous] = await Promise.all([
    prisma.profile.findUniqueOrThrow({
      where: { id: input.link.studentProfileId },
      // The tutor allow-list, not a wider select that happens to be filtered
      // later. A name is all the artifact needs.
      select: { studentName: true },
    }),
    prisma.testType.findUniqueOrThrow({
      where: { id: input.testTypeId },
      select: { code: true },
    }),
    prisma.scoreAttempt.findMany({
      where: {
        studentUserId: input.link.studentUserId,
        testTypeId: input.testTypeId,
      },
      orderBy: { takenAt: "asc" },
      select: {
        kind: true,
        takenAt: true,
        composite: true,
        isVerified: true,
        sectionScores: true,
      },
    }),
    prisma.progressArtifact.findFirst({
      where: {
        studentUserId: input.link.studentUserId,
        caseloadLinkId: input.link.id,
        // Prisma's JSON null is not SQL null — DbNull is the column being
        // unset, which is what a failed generation leaves behind.
        narrative: { not: Prisma.DbNull },
      },
      orderBy: { periodEnd: "desc" },
      select: { narrative: true },
    }),
  ]);

  // Attempts inside the reporting period. The rest still count toward the
  // superscore and the starting point — a parent's monthly update reports the
  // month, but the standing it reports against is the whole history.
  const inPeriod = allAttempts.filter(
    (a) => a.takenAt >= input.periodStart && a.takenAt <= input.periodEnd,
  );

  // The engagement's starting point is the FIRST attempt of any kind, which is
  // usually the diagnostic. Not the first in this period — a parent comparing
  // month three against month three has no idea whether the tutoring worked.
  const first = allAttempts[0];
  const startingComposite =
    first !== undefined
      ? computeComposite(
          (first.sectionScores ?? {}) as SectionScores,
          derived.rule,
          derived.schema,
        )
      : null;

  // What the binding school would actually see, which is the only "current
  // score" that means anything against the target.
  const bindingSuperscores = derived.target.contributions.some(
    (c) => c.schoolId === derived.target.bindingSchoolId && c.contributes,
  )
    ? (await prisma.schoolTestPolicy.findFirst({
        where: {
          schoolId: derived.target.bindingSchoolId ?? "",
          testTypeId: input.testTypeId,
        },
        orderBy: { effectiveCycle: "desc" },
        select: { superscores: true },
      }))?.superscores ?? false
    : false;

  const attemptsForComposite = allAttempts.map((a) => ({
    sectionScores: (a.sectionScores ?? {}) as SectionScores,
    composite: a.composite,
  }));
  const currentComposite = compositeAsSchoolSeesIt(
    attemptsForComposite,
    derived.rule,
    derived.schema,
    bindingSuperscores,
  );

  const status = targetStatus(currentComposite, derived.target);
  // The retake advice, not the raw focus. A section named here reaches a parent
  // as "what we are working on next", so it may only be named where a second
  // sitting can actually bank it — see retakeGuidance.
  const retake = retakeGuidance({
    allocations: derived.allocations,
    bindingSuperscores,
    bindingSchoolName: derived.target.bindingSchoolName,
  });
  const previousHeadline =
    previous?.narrative &&
    typeof previous.narrative === "object" &&
    "headline" in previous.narrative
      ? String((previous.narrative as { headline: unknown }).headline)
      : null;

  const context: ProgressContext = {
    studentName: profile.studentName ?? "your student",
    testCode: testType.code,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    attempts: inPeriod.map((a) => ({
      kind: a.kind,
      takenAt: a.takenAt,
      composite: a.composite,
      isVerified: a.isVerified,
    })),
    startingComposite,
    currentComposite,
    bestSectionScores: derived.best,
    target: {
      bindingComposite: derived.target.bindingComposite,
      bandLow: derived.target.bandLow,
      bandHigh: derived.target.bandHigh,
      setBy: derived.target.bindingSchoolName,
      status,
    },
    focusSection: retake.focusSection,
    focusDescription: retake.message,
    firedSignals: derived.signals.map((s) => ({ kind: s.kind, summary: s.summary })),
    handoff: isEngagementComplete(derived.signals)
      ? handoffMessage(derived.target)
      : null,
    previousHeadline,
  };

  const text = buildProgressUserPrompt(context);

  return {
    text,
    estimatedTokens: estimateInputTokens(text),
    context,
    firedKinds: derived.signals.map((s) => s.kind),
    rubricVersion: (await import("@/lib/readiness/score")).RUBRIC_VERSION,
    sourceDataVersion: derived.sourceDataVersion,
    computed: {
      startingComposite,
      currentComposite,
      bestSectionScores: derived.best,
      bandLow: derived.target.bandLow,
      bandHigh: derived.target.bandHigh,
      setBy: derived.target.bindingSchoolName,
      status,
    },
  };
}
