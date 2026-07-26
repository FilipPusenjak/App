// Ownership helpers — the privacy primitive.
//
// RULE: no database access for profile data happens without going through one of
// these. Every query is scoped by the *authenticated* user's id (from the
// session), never a client-supplied id. This is how "filter by the current user"
// can't be forgotten: the callers never see a userId to pass or omit.
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";

/**
 * The current user's profile, creating it on first access. (Signup creates only
 * a User; the Profile is materialized the first time they open their profile.)
 */
export async function getOrCreateProfile() {
  const userId = await requireUserId();
  const existing = await prisma.profile.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.profile.create({ data: { userId } });
}

/** The current user's full profile with its children, for rendering the page. */
export async function getProfileWithRelations() {
  const profile = await getOrCreateProfile();
  return prisma.profile.findUniqueOrThrow({
    where: { id: profile.id },
    include: {
      testScores: { orderBy: { createdAt: "asc" } },
      resumeItems: { orderBy: [{ startDate: "desc" }, { createdAt: "desc" }] },
      targetSchools: { orderBy: { createdAt: "asc" } },
    },
  });
}

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
