// One account, many students — and the two questions that answers.
//
// This is the counselor/agency feature: a tutoring agency runs several students
// from one login. Widening Profile.userId from unique to indexed changed WHO
// CAN HOLD a profile. It must not have changed WHO CAN READ one, and there are
// two separate things to prove:
//
//   1. Isolation BETWEEN accounts is unchanged. This is the privacy rule, it
//      concerns data about minors, and nothing here is allowed to weaken it.
//   2. Isolation BETWEEN students of one account. Weaker by design — a
//      counselor may edit any of their own students — but the ACTIVE student
//      must scope every list, or a counselor silently reads the wrong child's
//      evaluation and never finds out.
//
// The active-profile id is the new attack surface: it is stored on the user and
// could be pointed anywhere. Resolving it looks it up among the profiles the
// account actually owns, so a foreign id cannot resolve — that is what the last
// group tests.
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("multi");

/** Impersonate a user for the ownership helpers, which read the session. */
const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  getOrCreateProfile,
  getOwnedProfiles,
  getProfileWithRelations,
  findOwnedProfile,
  requireOwnedProfile,
  getOwnedEvaluations,
  findOwnedEvaluation,
} = await import("@/lib/ownership");

async function addStudent(userId: string, name: string) {
  return prisma.profile.create({ data: { userId, studentName: name } });
}

async function setActive(userId: string, profileId: string | null) {
  await prisma.user.update({
    where: { id: userId },
    data: { activeProfileId: profileId },
  });
}

describe.skipIf(!hasTestDb)("one account holding several students", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("lists every student on the account, oldest first", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "list");
    sessionUserId.current = user.id;

    const b = await addStudent(user.id, "Bea");
    const c = await addStudent(user.id, "Cai");

    const profiles = await getOwnedProfiles();
    expect(profiles.map((p) => p.id)).toEqual([profile.id, b.id, c.id]);
  });

  it("scopes the active student's data to that student alone", async () => {
    const { user, profile: alia } = await createUserWithProfile(runTag, "scope");
    sessionUserId.current = user.id;
    const bo = await addStudent(user.id, "Bo");

    await prisma.evaluation.create({
      data: { profileId: alia.id, status: "completed", overallScore: 11 },
    });
    await prisma.evaluation.create({
      data: { profileId: bo.id, status: "completed", overallScore: 22 },
    });

    await setActive(user.id, alia.id);
    expect((await getOwnedEvaluations()).map((e) => e.overallScore)).toEqual([11]);

    // A counselor switching students must see the other student's history and
    // ONLY the other student's history.
    await setActive(user.id, bo.id);
    expect((await getOwnedEvaluations()).map((e) => e.overallScore)).toEqual([22]);
  });

  it("keeps each student's own school details apart", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "details");
    sessionUserId.current = user.id;
    await prisma.profile.update({
      where: { id: profile.id },
      data: { gradeLevel: "Grade 9", intendedMajor: "Medicine" },
    });
    const other = await addStudent(user.id, "Other");
    await prisma.profile.update({
      where: { id: other.id },
      data: { gradeLevel: "Grade 12", intendedMajor: "History" },
    });

    await setActive(user.id, other.id);
    const loaded = await getProfileWithRelations();
    expect(loaded.gradeLevel).toBe("Grade 12");
    expect(loaded.intendedMajor).toBe("History");
  });

  it("gives each student their own country of origin", async () => {
    // It decides domestic vs international status, so sharing one across an
    // agency's students would change the assessment for most of them.
    const { user, profile } = await createUserWithProfile(runTag, "country");
    sessionUserId.current = user.id;
    await prisma.profile.update({
      where: { id: profile.id },
      data: { countryOfOrigin: "CA" },
    });
    const abroad = await addStudent(user.id, "Abroad");
    await prisma.profile.update({
      where: { id: abroad.id },
      data: { countryOfOrigin: "SG" },
    });

    await setActive(user.id, abroad.id);
    expect((await getOrCreateProfile()).countryOfOrigin).toBe("SG");
    await setActive(user.id, profile.id);
    expect((await getOrCreateProfile()).countryOfOrigin).toBe("CA");
  });
});

describe.skipIf(!hasTestDb)("resolving which student is active", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("falls back to the first student when none is selected", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "unset");
    sessionUserId.current = user.id;
    await addStudent(user.id, "Second");
    await setActive(user.id, null);

    expect((await getOrCreateProfile()).id).toBe(profile.id);
  });

  it("falls back when the selected student has been deleted", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "stale");
    sessionUserId.current = user.id;
    const doomed = await addStudent(user.id, "Doomed");
    await setActive(user.id, doomed.id);
    await prisma.profile.delete({ where: { id: doomed.id } });

    // A dangling id must not throw and must not resolve to nothing.
    expect((await getOrCreateProfile()).id).toBe(profile.id);
  });

  it("creates a first student for an account that has none", async () => {
    const user = await prisma.user.create({
      data: {
        email: `${runTag}-empty@example.test`,
        name: "Empty",
        passwordHash: "not-a-real-hash",
        countryOfOrigin: "IE",
      },
    });
    sessionUserId.current = user.id;

    const created = await getOrCreateProfile();
    expect(created.userId).toBe(user.id);
    // Inherits the account default, which is the right guess for an agency
    // working in one country.
    expect(created.countryOfOrigin).toBe("IE");
  });
});

describe.skipIf(!hasTestDb)("isolation BETWEEN accounts is unchanged", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("REFUSES to resolve another account's student as active", async () => {
    // The new attack surface: activeProfileId is a stored id that could be
    // pointed anywhere. It is resolved by searching this account's own
    // profiles, so a foreign id cannot be found however it got there.
    const mine = await createUserWithProfile(runTag, "victim");
    const theirs = await createUserWithProfile(runTag, "attacker");

    await setActive(mine.user.id, theirs.profile.id);
    sessionUserId.current = mine.user.id;

    const resolved = await getOrCreateProfile();
    expect(resolved.id).toBe(mine.profile.id);
    expect(resolved.id).not.toBe(theirs.profile.id);
  });

  it("refuses to look up another account's student by id", async () => {
    const mine = await createUserWithProfile(runTag, "look-mine");
    const theirs = await createUserWithProfile(runTag, "look-theirs");
    sessionUserId.current = mine.user.id;

    expect(await findOwnedProfile(theirs.profile.id)).toBeNull();
    await expect(requireOwnedProfile(theirs.profile.id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("never lists another account's students", async () => {
    const mine = await createUserWithProfile(runTag, "list-mine");
    const theirs = await createUserWithProfile(runTag, "list-theirs");
    await addStudent(theirs.user.id, "Not Yours");
    sessionUserId.current = mine.user.id;

    const ids = (await getOwnedProfiles()).map((p) => p.id);
    expect(ids).toEqual([mine.profile.id]);
  });

  it("never reads an evaluation belonging to another account", async () => {
    const mine = await createUserWithProfile(runTag, "eval-mine");
    const theirs = await createUserWithProfile(runTag, "eval-theirs");
    const hidden = await prisma.evaluation.create({
      data: { profileId: theirs.profile.id, status: "completed", overallScore: 99 },
    });

    sessionUserId.current = mine.user.id;
    expect(await findOwnedEvaluation(hidden.id)).toBeNull();
    expect(await getOwnedEvaluations()).toEqual([]);
  });

  it("still finds a SECOND student's evaluation within the same account", async () => {
    // The deliberate asymmetry: a counselor may reach any of their own
    // students' records, which is what makes one login usable at all.
    const { user, profile } = await createUserWithProfile(runTag, "own-second");
    const second = await addStudent(user.id, "Second");
    const evaluation = await prisma.evaluation.create({
      data: { profileId: second.id, status: "completed", overallScore: 55 },
    });

    sessionUserId.current = user.id;
    await setActive(user.id, profile.id);

    // Not in the ACTIVE student's list...
    expect(await getOwnedEvaluations()).toEqual([]);
    // ...but reachable by id, because it belongs to this account.
    expect((await findOwnedEvaluation(evaluation.id))?.id).toBe(evaluation.id);
  });
});

describe.skipIf(!hasTestDb)("deleting a student", () => {
  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("takes their evaluations with them and leaves the others alone", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "del");
    sessionUserId.current = user.id;
    const doomed = await addStudent(user.id, "Doomed");

    await prisma.evaluation.create({
      data: { profileId: doomed.id, status: "completed", overallScore: 1 },
    });
    const keep = await prisma.evaluation.create({
      data: { profileId: profile.id, status: "completed", overallScore: 2 },
    });

    await prisma.profile.delete({ where: { id: doomed.id } });

    expect(
      await prisma.evaluation.count({ where: { profileId: doomed.id } }),
    ).toBe(0);
    expect(
      (await prisma.evaluation.findUnique({ where: { id: keep.id } }))?.id,
    ).toBe(keep.id);
  });

  it("still erases every student when the account itself goes", async () => {
    const { user, profile } = await createUserWithProfile(runTag, "cascade");
    const second = await addStudent(user.id, "Second");

    await prisma.user.delete({ where: { id: user.id } });

    expect(
      await prisma.profile.count({ where: { id: { in: [profile.id, second.id] } } }),
    ).toBe(0);
  });
});
