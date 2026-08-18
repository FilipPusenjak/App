// What the student says happened, between check-ins.
//
// Every read and write here resolves the profile from the authenticated
// session, never from anything a client sends — the same structural rule as
// lib/ownership, and it matters more here than almost anywhere else in the app.
// This table holds free text a 14-year-old wrote about their own life. It is
// the least structured and most personal thing stored, so the ownership check
// is on the query rather than in a conditional a later edit could forget.
//
// SERVER ONLY. The limits and schema live in lib/validation/developments so a
// client component can import them without dragging Prisma — and therefore
// `pg`, `dns` and `fs` — into the browser bundle. That mistake does not fail
// gracefully: it breaks compilation of every page in the app.
import { prisma } from "@/lib/db";
import { getOrCreateProfile } from "@/lib/ownership";
import type { DevelopmentInput } from "@/lib/validation/developments";

export {
  DEVELOPMENT_MAX,
  developmentInputSchema,
  type DevelopmentInput,
} from "@/lib/validation/developments";

/** Record one. The commitment, if named, must belong to the same profile. */
export async function addDevelopment(input: DevelopmentInput) {
  const profile = await getOrCreateProfile();

  // A commitment id arriving from a form is client-supplied, so it is checked
  // against this profile before it is stored. Unverified, it would let one
  // account attach its notes to another's commitment — the only cross-account
  // write this table could otherwise permit.
  let commitmentId: string | null = null;
  if (input.commitmentId) {
    const owned = await prisma.commitment.findFirst({
      where: { id: input.commitmentId, profileId: profile.id },
      select: { id: true },
    });
    commitmentId = owned?.id ?? null;
  }

  return prisma.development.create({
    data: { profileId: profile.id, body: input.body, commitmentId },
    select: { id: true, body: true, createdAt: true, commitmentId: true },
  });
}

/** The ones a check-in has not read yet, oldest first. */
export async function getUnreadDevelopments(profileId: string) {
  return prisma.development.findMany({
    where: { profileId, readByEvaluationId: null },
    orderBy: { createdAt: "asc" },
    // Bounded: a student who wrote thirty notes should not be able to make one
    // check-in cost ten times another. The oldest are the ones a check-in is
    // most overdue to acknowledge.
    take: 20,
    select: { id: true, body: true, createdAt: true, commitmentId: true },
  });
}

/** Recent ones regardless of whether a check-in read them, for a deep review. */
export async function getRecentDevelopments(profileId: string, since: Date | null) {
  return prisma.development.findMany({
    where: { profileId, ...(since ? { createdAt: { gt: since } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 40,
    select: { id: true, body: true, createdAt: true, commitmentId: true },
  });
}

/**
 * Mark these as read by the evaluation that just used them.
 *
 * Without this a student is told about the same news every fortnight, which
 * reads as the app not listening — and it is also the check-in re-litigating
 * old ground, which is exactly what the cadence exists to prevent.
 */
export async function markDevelopmentsRead(ids: string[], evaluationId: string) {
  if (ids.length === 0) return;
  await prisma.development.updateMany({
    where: { id: { in: ids } },
    data: { readByEvaluationId: evaluationId },
  });
}

/** The most recent, for showing back to the student. Ownership-scoped. */
export async function getOwnedDevelopments(limit = 10) {
  const profile = await getOrCreateProfile();
  return prisma.development.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      body: true,
      createdAt: true,
      commitmentId: true,
      readByEvaluationId: true,
    },
  });
}

/**
 * Remove one.
 *
 * Deletion is not a nicety here. This is free text a minor wrote about their
 * own life, sometimes in the moment, and the ability to take it back is part of
 * it being safe to write at all. Scoped by profile in the WHERE clause, so
 * another account's note does not exist to this request rather than being
 * refused.
 */
export async function deleteDevelopment(id: string): Promise<boolean> {
  const profile = await getOrCreateProfile();
  const result = await prisma.development.deleteMany({
    where: { id, profileId: profile.id },
  });
  return result.count > 0;
}
