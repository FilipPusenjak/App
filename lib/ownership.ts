// Ownership helpers — the privacy primitive.
//
// RULE: no database access for profile data happens without going through one of
// these. Every query is scoped by the *authenticated* user's id (from the
// session), never a client-supplied id. This is how "filter by the current user"
// can't be forgotten: the callers never see a userId to pass or omit.
//
// An account holds MANY students (a counselor or tutoring agency runs several
// from one login), and that changed who can hold a profile without changing
// who can read one: every check below still routes through Profile.userId
// against the session's user. The per-student scoping is a SEPARATE question,
// answered by getOrCreateProfile resolving the active student — so a bug there
// could show the wrong student of your own, never someone else's.
import { cache } from "react";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";

/**
 * Every student this account holds, oldest first.
 *
 * An account owns its students outright — there is no sharing and no
 * cross-account access — so "all profiles for this user" is the complete list
 * and needs no further filtering.
 */
export const getOwnedProfiles = cache(async () => {
  const userId = await requireUserId();
  return prisma.profile.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
});

/**
 * The student currently being worked on, creating one on first access.
 *
 * The active id is stored on the user and is NEVER trusted on its own. It is
 * resolved by looking for it among the profiles this account actually owns, so
 * a stale id (the student was deleted) or a tampered one (someone else's id)
 * simply is not found and falls back to the first student. That check is
 * structural rather than a conditional someone could forget to write.
 */
export const getOrCreateProfile = cache(async () => {
  const userId = await requireUserId();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      activeProfileId: true,
      countryOfOrigin: true,
      profiles: { orderBy: { createdAt: "asc" } },
    },
  });

  const active =
    user.profiles.find((p) => p.id === user.activeProfileId) ?? user.profiles[0];
  if (active) return active;

  // First ever visit: signup creates only a User.
  return prisma.profile.create({
    data: { userId, countryOfOrigin: user.countryOfOrigin },
  });
});

/** A student profile owned by the current user, or null. */
export async function findOwnedProfile(profileId: string) {
  const userId = await requireUserId();
  return prisma.profile.findFirst({ where: { id: profileId, userId } });
}

/** Assert ownership of a student profile before switching to or mutating it. */
export async function requireOwnedProfile(profileId: string) {
  const profile = await findOwnedProfile(profileId);
  if (!profile) throw new Error("Student not found");
  return profile;
}

/**
 * The current user's full profile with its children, for rendering the page.
 *
 * Fetches by userId in a single query rather than looking the profile up and
 * then fetching it again by id — that second round trip cost nothing against a
 * local database and is very noticeable against a hosted one. The create path
 * runs only on a user's first ever visit.
 *
 * The include is written out at both call sites on purpose: hoisting it to a
 * shared constant loses Prisma's type inference for the returned relations.
 */
export const getProfileWithRelations = cache(async () => {
  // Ownership is established here; the lookup below is by primary key, which
  // is safe precisely because this call already proved the profile is ours.
  const { id } = await getOrCreateProfile();

  return prisma.profile.findUniqueOrThrow({
    where: { id },
    include: {
      testScores: { orderBy: { createdAt: "asc" } },
      resumeItems: { orderBy: [{ startDate: "desc" }, { createdAt: "desc" }] },
      targetSchools: { orderBy: { createdAt: "asc" } },
    },
  });
});

/** A resume item owned by the current user, or null. */
export async function findOwnedResumeItem(itemId: string) {
  const userId = await requireUserId();
  return prisma.resumeItem.findFirst({
    where: { id: itemId, profile: { userId } },
  });
}

/** Assert ownership of a resume item before mutating/deleting it. */
export async function requireOwnedResumeItem(itemId: string) {
  const item = await findOwnedResumeItem(itemId);
  if (!item) throw new Error("Resume item not found");
  return item;
}

/** Assert ownership of a test score before deleting it. */
export async function requireOwnedTestScore(scoreId: string) {
  const userId = await requireUserId();
  const score = await prisma.testScore.findFirst({
    where: { id: scoreId, profile: { userId } },
  });
  if (!score) throw new Error("Test score not found");
  return score;
}

/** All target schools for the current user's profile. */
export async function getOwnedTargets() {
  const profile = await getOrCreateProfile();
  return prisma.targetSchool.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: "asc" },
  });
}

/** A target school owned by the current user, or null. */
export async function findOwnedTargetSchool(id: string) {
  const userId = await requireUserId();
  return prisma.targetSchool.findFirst({
    where: { id, profile: { userId } },
  });
}

/** Assert ownership of a target school before mutating/deleting it. */
export async function requireOwnedTargetSchool(id: string) {
  const target = await findOwnedTargetSchool(id);
  if (!target) throw new Error("Target school not found");
  return target;
}

/** The current user's evaluations, newest first (list/history view). */
export async function getOwnedEvaluations() {
  const profile = await getOrCreateProfile();
  return prisma.evaluation.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: "desc" },
  });
}

/** A single evaluation owned by the current user, or null. */
export async function findOwnedEvaluation(id: string) {
  const userId = await requireUserId();
  return prisma.evaluation.findFirst({
    where: { id, profile: { userId } },
  });
}

/**
 * The model that judged the real evaluation immediately before this one, for
 * the same student — or null when this was the first.
 *
 * Exists so a page can say outright when the judge changed between two runs.
 * Follow-up evaluations run on a cheaper model anchored to the previous
 * scores, which keeps them comparable; a student comparing two numbers is
 * still owed the fact that a different model produced them.
 *
 * Ownership-scoped like everything else: the userId filter is on the query,
 * and `profileId` is read from a row already proven to belong to the caller.
 */
export async function findPrecedingEvaluationModel(evaluation: {
  profileId: string;
  createdAt: Date;
}): Promise<string | null> {
  const userId = await requireUserId();
  const previous = await prisma.evaluation.findFirst({
    where: {
      profile: { id: evaluation.profileId, userId },
      status: "completed",
      isSample: false,
      createdAt: { lt: evaluation.createdAt },
    },
    orderBy: { createdAt: "desc" },
    select: { model: true },
  });
  return previous?.model ?? null;
}

/** The current user's planned ("things I intend to do") items. */
export async function getOwnedPlannedItems() {
  const profile = await getOrCreateProfile();
  return prisma.plannedItem.findMany({
    where: { profileId: profile.id },
    orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
  });
}

/** A planned item owned by the current user, or null. */
export async function findOwnedPlannedItem(id: string) {
  const userId = await requireUserId();
  return prisma.plannedItem.findFirst({
    where: { id, profile: { userId } },
  });
}

/** Assert ownership of a planned item before mutating/deleting it. */
export async function requireOwnedPlannedItem(id: string) {
  const item = await findOwnedPlannedItem(id);
  if (!item) throw new Error("Planned item not found");
  return item;
}

/** The current user's projections, newest first. */
export async function getOwnedProjections() {
  const profile = await getOrCreateProfile();
  return prisma.projection.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: "desc" },
  });
}

/** A single projection owned by the current user, or null. */
export async function findOwnedProjection(id: string) {
  const userId = await requireUserId();
  return prisma.projection.findFirst({
    where: { id, profile: { userId } },
  });
}
