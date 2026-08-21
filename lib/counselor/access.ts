// Counselor access — the privacy primitive for the counselor edition.
//
// Same rule as lib/ownership.ts, and a strictly harder problem. There, an
// account owns its students outright and "filter by the session's user id" is
// the whole check. Here a counselor reads records belonging to SOMEONE ELSE,
// under a grant that can be narrower than the record and can be withdrawn
// without warning. Three things must therefore be true of every read, and none
// of them can be left to a caller to remember:
//
//   1. DUAL CONSENT. Both the student and a guardian have approved, and the
//      link is ACTIVE. A PENDING link returns nothing at all — not a redacted
//      view, not an empty profile, nothing.
//
//   2. SCOPE AT THE QUERY LAYER. ACADEMIC_ONLY does not fetch activities. The
//      difference between "not rendered" and "not fetched" is the difference
//      between a UI convention and a security property, and only the second
//      one survives a new component, a JSON route, or a debug log.
//
//   3. THE READ IS LOGGED. Every one, visible to the student. An audit log the
//      subject cannot see is a log for the operator's benefit.
//
// There is deliberately NO write path here. A counselor proposes; the student
// accepts. Nothing in this module can mutate a Profile, a ResumeItem, a
// TestScore or a TargetSchool, and lib/counselor has no other door.
import { cache } from "react";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import type { LinkScope } from "@/lib/validation/counselor";

/** The counselor account for the signed-in user, or null if they are not one. */
export const getCounselorAccount = cache(async () => {
  const userId = await requireUserId();
  return prisma.counselorAccount.findUnique({ where: { userId } });
});

/** The counselor account, or a thrown error. For routes that require one. */
export async function requireCounselorAccount() {
  const account = await getCounselorAccount();
  if (!account) {
    throw new Error("This account is not a counselor account.");
  }
  return account;
}

/**
 * Whether a link may be read through RIGHT NOW.
 *
 * Written as a Prisma `where` fragment rather than a boolean helper, so it
 * composes into the query instead of being checked beside it. A caller cannot
 * accidentally fetch first and check afterwards, because there is nothing to
 * fetch without this.
 *
 * `endedAt: null` is redundant beside `status: ACTIVE` and is kept anyway: a
 * revocation writes both, and a bug that set one without the other should
 * fail closed rather than depend on which field the reader happened to trust.
 */
export function readableLinkWhere(counselorAccountId: string) {
  return {
    counselorAccountId,
    status: "ACTIVE",
    endedAt: null,
    // DUAL CONSENT, as a query condition. Both must be present.
    studentConsentAt: { not: null },
    guardianConsentAt: { not: null },
  } as const;
}

/**
 * Which profile relations a scope permits.
 *
 * Returned as a Prisma `include`, so a scope the caller does not honour is not
 * a scope the caller can violate — the rows never leave Postgres.
 *
 * Note what is common to all three: gradeLevel, graduationYear and the school
 * context always come through. A counselor who cannot see which YEAR a student
 * is in cannot triage them at all, and a grade level is not the sensitive part
 * of an academic record.
 */
export function scopedProfileInclude(scope: LinkScope) {
  const academics = scope === "FULL" || scope === "ACADEMIC_ONLY";
  const activities = scope === "FULL" || scope === "ACTIVITIES_ONLY";

  return {
    // Coursework lives in ResumeItem alongside activities, so ACADEMIC_ONLY
    // cannot simply take the table — it takes the coursework rows out of it.
    // Filtering in the WHERE rather than after the fetch is the point.
    resumeItems: activities
      ? { orderBy: { createdAt: "desc" as const } }
      : academics
        ? {
            where: { type: "coursework" },
            orderBy: { createdAt: "desc" as const },
          }
        : ({ where: { id: "" } } as const),
    testScores: academics ? true : ({ where: { id: "" } } as const),
    // Targets are what an activity portfolio is judged AGAINST, so they belong
    // to the activities scope as well as the full one.
    targetSchools: activities || academics ? true : ({ where: { id: "" } } as const),
  };
}

/** Fields a scope permits on the profile row itself. */
export function scopedProfileSelectFields(scope: LinkScope) {
  const academics = scope === "FULL" || scope === "ACADEMIC_ONLY";
  return {
    id: true,
    studentName: true,
    gradeLevel: true,
    graduationYear: true,
    schoolName: true,
    schoolContext: true,
    countryOfOrigin: true,
    intendedMajor: true,
    careerGoal: true,
    updatedAt: true,
    createdAt: true,
    // The numbers a subject tutor may see and an activities coach may not.
    curriculum: academics,
    gpa: academics,
    gpaScale: academics,
  };
}

export type ReadableLink = {
  id: string;
  counselorAccountId: string;
  studentProfileId: string;
  studentUserId: string;
  scope: LinkScope;
  startedAt: Date | null;
};

/**
 * One link this counselor may currently read through, or null.
 *
 * Takes a link id from the URL and RESOLVES it against the counselor's own
 * readable links rather than trusting it — the same structural move as
 * getOrCreateProfile. A link id belonging to another counselor, or to a
 * revoked grant, is simply not found.
 */
export async function findReadableLink(
  linkId: string,
): Promise<ReadableLink | null> {
  const account = await getCounselorAccount();
  if (!account) return null;

  const link = await prisma.caseloadLink.findFirst({
    where: { id: linkId, ...readableLinkWhere(account.id) },
    select: {
      id: true,
      counselorAccountId: true,
      studentProfileId: true,
      studentUserId: true,
      scope: true,
      startedAt: true,
    },
  });
  return link ? { ...link, scope: link.scope as LinkScope } : null;
}

/** Every link this counselor may currently read through. */
export async function listReadableLinks(): Promise<ReadableLink[]> {
  const account = await getCounselorAccount();
  if (!account) return [];

  const links = await prisma.caseloadLink.findMany({
    where: readableLinkWhere(account.id),
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
  return links.map((l) => ({ ...l, scope: l.scope as LinkScope }));
}

/**
 * Record that a counselor looked at something.
 *
 * Deliberately fire-and-forget from the caller's perspective but AWAITED here:
 * a read that completes while its log write is still in flight is a read that
 * can be lost on a serverless instance that shuts down first. The cost is a
 * round trip; the alternative is an audit log with holes in exactly the
 * circumstances someone would later be asking about.
 */
export async function logCounselorRead(input: {
  link: ReadableLink;
  surface: string;
}): Promise<void> {
  await prisma.counselorReadLog.create({
    data: {
      counselorAccountId: input.link.counselorAccountId,
      caseloadLinkId: input.link.id,
      studentProfileId: input.link.studentProfileId,
      surface: input.surface,
      // The scope AS IT WAS. A link narrowed later must not make an earlier,
      // broader read look narrower than it was.
      scope: input.link.scope,
    },
  });
}

/**
 * Load a student through a link, at that link's scope, logging the read.
 *
 * The only way counselor-side code obtains student data. It returns null rather
 * than throwing when access is absent, because "this link is no longer readable"
 * is an ordinary state — a student revoked it, a link was paused — and not an
 * exceptional one.
 */
export async function readStudentThroughLink(input: {
  linkId: string;
  surface: string;
}) {
  const link = await findReadableLink(input.linkId);
  if (!link) return null;

  const profile = await prisma.profile.findUnique({
    where: { id: link.studentProfileId },
    select: {
      ...scopedProfileSelectFields(link.scope),
      ...scopedProfileInclude(link.scope),
    },
  });
  if (!profile) return null;

  await logCounselorRead({ link, surface: input.surface });
  return { link, profile };
}

/* ── The student's side ──────────────────────────────────────────────────── */

/**
 * Who can see this account's students, at what scope.
 *
 * Reads by the STUDENT's session, not the counselor's — this is the surface
 * that makes the grant visible to the person it is about, which is the only
 * thing that makes revocation meaningful.
 */
export async function listGrantsForStudent() {
  const userId = await requireUserId();
  return prisma.caseloadLink.findMany({
    where: { studentUserId: userId, status: { not: "ENDED" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      scope: true,
      invitedBy: true,
      studentConsentAt: true,
      guardianConsentAt: true,
      startedAt: true,
      studentProfileId: true,
      counselorAccount: {
        select: { orgName: true, type: true, user: { select: { name: true } } },
      },
    },
  });
}

/**
 * End a grant, immediately.
 *
 * Does NOT require counselor approval and does not notify before taking effect.
 * A revocation that waits on the other party is not a revocation. Scoped by the
 * student's own session in the WHERE clause, so a link belonging to someone else
 * is not "rejected" — it does not exist to this request.
 */
export async function revokeGrant(linkId: string): Promise<boolean> {
  const userId = await requireUserId();
  const { count } = await prisma.caseloadLink.updateMany({
    where: { id: linkId, studentUserId: userId, status: { not: "ENDED" } },
    data: { status: "ENDED", endedAt: new Date() },
  });
  return count > 0;
}

/** What a counselor has actually looked at, for the student to read. */
export async function listReadsForStudent(profileId: string, take = 100) {
  const userId = await requireUserId();

  // The profile is proven to belong to this account before its log is read,
  // so a profile id from a URL cannot expose another student's access history.
  const owned = await prisma.profile.findFirst({
    where: { id: profileId, userId },
    select: { id: true },
  });
  if (!owned) return [];

  return prisma.counselorReadLog.findMany({
    where: { studentProfileId: profileId },
    orderBy: { readAt: "desc" },
    take,
    select: {
      id: true,
      surface: true,
      scope: true,
      readAt: true,
      counselorAccount: {
        select: { orgName: true, user: { select: { name: true } } },
      },
    },
  });
}
