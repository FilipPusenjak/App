// What a test-prep tutor may read, and the query-layer fact that stops them.
//
// TEST_PREP_ONLY is the narrowest scope in the product: score history, the
// target school list, and the thresholds derived from those two. No activities,
// no essays, no differentiation data, no counselor notes.
//
// ENFORCED HERE, NOT IN A COMPONENT. The brief says "at the query layer, not the
// UI layer" and that distinction is the whole security property: a scope that is
// merely not rendered survives until someone adds a JSON route, a debug log, or
// an export — and then it does not. The reason this file returns SELECTS rather
// than booleans is that a caller cannot forget to apply a select the way they
// can forget to check a flag.
//
// It builds on lib/counselor/access.ts rather than replacing it. Dual consent,
// revocation and the audit log are identical for a tutor: they read a minor's
// record under a grant the family can withdraw without notice, and nothing about
// being engaged for one number changes that.
import { prisma } from "@/lib/db";
import {
  findReadableLink,
  logCounselorRead,
  readableLinkWhere,
  requireCounselorAccount,
  type ReadableLink,
} from "@/lib/counselor/access";
import { TEST_PREP_SCOPE } from "@/lib/validation/testprep";

/**
 * The link a tutor may read through, or null.
 *
 * Adds ONE condition to the counselor version: the scope must actually be
 * TEST_PREP_ONLY. A tutor holding a FULL-scope link would be a counselor by
 * another name, and the whole argument for this product's narrower access is
 * that the narrowness is real.
 */
export async function findTutorLink(linkId: string): Promise<ReadableLink | null> {
  const link = await findReadableLink(linkId);
  if (!link) return null;
  if (link.scope !== TEST_PREP_SCOPE) return null;
  return link;
}

/** Every student this tutor may currently read. */
export async function listTutorLinks(): Promise<ReadableLink[]> {
  const account = await requireCounselorAccount();
  const links = await prisma.caseloadLink.findMany({
    where: { ...readableLinkWhere(account.id), scope: TEST_PREP_SCOPE },
    // ORDERED BY WHEN THE GRANT STARTED, and never by anything about the
    // student. See lib/testprep/roster.ts — ranking a caseload by score is the
    // one thing this product must never do.
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      counselorAccountId: true,
      studentProfileId: true,
      studentUserId: true,
      scope: true,
      startedAt: true,
    },
  });
  return links.map((l) => ({ ...l, scope: l.scope as ReadableLink["scope"] }));
}

/**
 * The ONLY profile fields a test-prep tutor may see.
 *
 * Written out rather than derived by subtraction, because a field added to
 * Profile next year must default to INVISIBLE here. A deny-list would silently
 * hand every new column to a tutor the day it was created.
 *
 * Note what is absent and deliberately so: gpa, curriculum, schoolContext,
 * intendedMajor, careerGoal. None of them are a test-prep tutor's business, and
 * several of them are exactly what a differentiation reading is built from.
 */
export const TUTOR_PROFILE_SELECT = {
  id: true,
  studentName: true,
  gradeLevel: true,
  graduationYear: true,
} as const;

/**
 * Read a student through a tutor's link, logging the read.
 *
 * The log is not optional and is awaited rather than fired off, for the same
 * reason it is in the counselor edition: a read that is not recorded is a read
 * the student cannot see happened, and the audit trail is theirs.
 */
export async function readStudentThroughTutorLink(input: {
  linkId: string;
  surface: string;
}): Promise<{
  link: ReadableLink;
  profile: {
    id: string;
    studentName: string | null;
    gradeLevel: string | null;
    graduationYear: number | null;
  };
} | null> {
  const link = await findTutorLink(input.linkId);
  if (!link) return null;

  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: link.studentProfileId },
    select: TUTOR_PROFILE_SELECT,
  });

  await logCounselorRead({ link, surface: input.surface });
  return { link, profile };
}

/**
 * The target school list, as a tutor may see it.
 *
 * Names and countries only — the fields a score policy attaches to. `notes` is
 * excluded on purpose: a student's private note about why a school matters to
 * them is not part of a test-prep engagement.
 */
export async function readTargetSchools(link: ReadableLink) {
  return prisma.targetSchool.findMany({
    where: { profileId: link.studentProfileId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, country: true, course: true },
  });
}

/** Score history for one student and test, oldest first. */
export async function readScoreHistory(input: {
  studentUserId: string;
  testTypeId: string;
}) {
  return prisma.scoreAttempt.findMany({
    where: {
      studentUserId: input.studentUserId,
      testTypeId: input.testTypeId,
    },
    orderBy: { takenAt: "asc" },
    select: {
      id: true,
      kind: true,
      takenAt: true,
      sectionScores: true,
      composite: true,
      enteredBy: true,
      isVerified: true,
    },
  });
}
