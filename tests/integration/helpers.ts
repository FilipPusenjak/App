// Shared fixtures for integration tests.
//
// Each test file tags the users it creates with a unique run prefix and
// deletes them afterwards, so files can't trip over each other's data and a
// crashed run doesn't poison the next one.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

/** Integration tests skip themselves when no test database is configured. */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

/** A per-file tag; users created with it are cleaned up in one sweep. */
export function makeRunTag(fileLabel: string) {
  return `it-${fileLabel}-${randomUUID().slice(0, 8)}`;
}

/**
 * A user + profile, ready to hang resume items / scores / targets off.
 * The password hash is a placeholder — these tests never log in through
 * the real auth flow (the e2e test covers that).
 */
export async function createUserWithProfile(runTag: string, label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${runTag}-${label}@example.test`,
      name: `Test ${label}`,
      passwordHash: "not-a-real-hash",
      profile: { create: {} },
    },
    include: { profile: true },
  });
  return { user, profile: user.profile! };
}

/** Delete every user this run created (children cascade from User). */
export async function cleanupRun(runTag: string) {
  await prisma.user.deleteMany({
    where: { email: { startsWith: runTag } },
  });
}
