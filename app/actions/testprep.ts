"use server";

// The test-prep tutor's write actions.
//
// There are three, and the list is short on purpose. A tutor may record a score,
// acknowledge a stopping signal, and append their own note to an artifact. They
// may NOT write to a student's profile — not their grade level, not their target
// list, not anything. The brief says "no tutor write access to student profile
// fields" and there is a source-level test reading this directory to keep it so.
//
// Every action resolves the link through findTutorLink, which requires an ACTIVE
// grant, dual consent, and a TEST_PREP_ONLY scope. A link id from a form is a
// claim to be checked, never an instruction to be followed.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCounselorAccount, readableLinkWhere } from "@/lib/counselor/access";
import { findTutorLink } from "@/lib/testprep/access";
import { deriveAndPersist } from "@/lib/testprep/derive";
import { computeComposite } from "@/lib/testprep/composite";
import {
  attemptKindSchema,
  compositeRuleSchema,
  testSectionSchemaSchema,
} from "@/lib/validation/testprep";

export type TutorResult = { ok?: boolean; message?: string; error?: string };

const idSchema = z.string().trim().min(1);

/**
 * Acknowledge a stopping signal.
 *
 * Scoped through the tutor's own readable links in the WHERE clause, so a signal
 * belonging to somebody else's student is not rejected — it is not found.
 *
 * Note what this does NOT do: it does not resolve, hide, dismiss or suppress the
 * signal. The signal stays live and stays on screen. Acknowledging records that
 * a professional read it, which is the point — the tutor cannot later say they
 * were not told.
 */
export async function acknowledgeStoppingAction(
  _prev: TutorResult,
  fd: FormData,
): Promise<TutorResult> {
  const parsed = idSchema.safeParse(String(fd.get("signalId") ?? ""));
  if (!parsed.success) return { error: "Which signal?" };

  const account = await requireCounselorAccount().catch(() => null);
  if (!account) return { error: "This account is not a tutor account." };

  // Resolved through the links this tutor may actually read.
  const links = await prisma.caseloadLink.findMany({
    where: { ...readableLinkWhere(account.id), scope: "TEST_PREP_ONLY" },
    select: { studentUserId: true },
  });
  if (links.length === 0) return { error: "Not found." };

  const signal = await prisma.stoppingSignal.findFirst({
    where: {
      id: parsed.data,
      studentUserId: { in: links.map((l) => l.studentUserId) },
    },
    select: { id: true, acknowledgedByTutorAt: true },
  });
  if (!signal) return { error: "Not found." };
  if (signal.acknowledgedByTutorAt) return { ok: true, message: "Already acknowledged." };

  await prisma.stoppingSignal.update({
    where: { id: signal.id },
    data: { acknowledgedByTutorAt: new Date() },
  });

  revalidatePath("/students-testprep");
  return { ok: true, message: "Acknowledged." };
}

const scoreSchema = z.object({
  linkId: idSchema,
  testTypeId: idSchema,
  kind: attemptKindSchema,
  takenAt: z.coerce.date(),
});

/**
 * Record a sitting.
 *
 * The composite is COMPUTED from the sections rather than accepted from the
 * form. A typed composite that disagrees with its own sections is a number
 * nobody can explain later, and it would be the number a parent sees.
 *
 * Recording a score recomputes the target and the stopping signals immediately.
 * That is the one recomputation trigger a tutor sees happen, and it is the point
 * at which a student may cross into "you are done" — which they should be told
 * about in the session, not next month.
 */
export async function recordScoreAction(
  _prev: TutorResult,
  fd: FormData,
): Promise<TutorResult> {
  const parsed = scoreSchema.safeParse({
    linkId: String(fd.get("linkId") ?? ""),
    testTypeId: String(fd.get("testTypeId") ?? ""),
    kind: String(fd.get("kind") ?? "PRACTICE"),
    takenAt: String(fd.get("takenAt") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const link = await findTutorLink(parsed.data.linkId);
  if (!link) return { error: "No access to that student." };

  const testType = await prisma.testType.findUnique({
    where: { id: parsed.data.testTypeId },
    select: { sectionSchema: true, compositeRule: true },
  });
  if (!testType) return { error: "Unknown test." };

  const schema = testSectionSchemaSchema.safeParse(testType.sectionSchema);
  const rule = compositeRuleSchema.safeParse(testType.compositeRule);
  if (!schema.success || !rule.success) return { error: "That test is misconfigured." };

  // Section scores, read against the test's own schema and range-checked. A
  // score outside its section's range is a typo, and a typo that reaches the
  // target derivation moves a family's target.
  const sectionScores: Record<string, number> = {};
  for (const section of schema.data.sections) {
    const raw = String(fd.get(`section:${section.name}`) ?? "").trim();
    if (raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return { error: `${section.name} must be a number.` };
    }
    if (value < section.min || value > section.max) {
      return {
        error: `${section.name} must be between ${section.min} and ${section.max}.`,
      };
    }
    sectionScores[section.name] = value;
  }
  if (Object.keys(sectionScores).length === 0) {
    return { error: "Enter at least one section score." };
  }

  await prisma.scoreAttempt.create({
    data: {
      studentUserId: link.studentUserId,
      testTypeId: parsed.data.testTypeId,
      kind: parsed.data.kind,
      takenAt: parsed.data.takenAt,
      sectionScores,
      composite: computeComposite(sectionScores, rule.data, schema.data),
      enteredBy: "TUTOR",
      // A tutor typing a score has not seen a score report. Marked honestly, and
      // the artifact says so wherever it shows one.
      isVerified: false,
    },
  });

  await deriveAndPersist({
    studentUserId: link.studentUserId,
    profileId: link.studentProfileId,
    testTypeId: parsed.data.testTypeId,
  });

  revalidatePath(`/students-testprep/${parsed.data.linkId}`);
  return { ok: true, message: "Recorded, and the target has been recomputed." };
}

/**
 * Append the tutor's own context to an artifact.
 *
 * APPEND, not edit. The generated body is not writable and neither is the
 * stopping notice inside it — that is the entire reason the body is immutable.
 * A tutor may add what they know; they may not remove what the engine found.
 */
export async function appendArtifactNoteAction(
  _prev: TutorResult,
  fd: FormData,
): Promise<TutorResult> {
  const id = idSchema.safeParse(String(fd.get("artifactId") ?? ""));
  const note = z
    .string()
    .trim()
    .max(2000)
    .safeParse(String(fd.get("tutorNote") ?? ""));
  if (!id.success) return { error: "Which update?" };
  if (!note.success) return { error: "That note is too long." };

  const account = await requireCounselorAccount().catch(() => null);
  if (!account) return { error: "This account is not a tutor account." };

  const artifact = await prisma.progressArtifact.findFirst({
    where: {
      id: id.data,
      caseloadLink: { ...readableLinkWhere(account.id), scope: "TEST_PREP_ONLY" },
    },
    select: { id: true },
  });
  if (!artifact) return { error: "Not found." };

  await prisma.progressArtifact.update({
    where: { id: artifact.id },
    // Only tutorNote. The narrative column is never a target of an update
    // anywhere in this codebase.
    data: { tutorNote: note.data || null },
  });

  revalidatePath("/students-testprep");
  return { ok: true, message: "Saved." };
}
