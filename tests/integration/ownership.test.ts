// The ownership helpers — the security core of the whole app.
//
// The rule these tests enforce is the one the app was built around: every
// query for profile data is scoped by the AUTHENTICATED user's id, and there
// is no way to reach another user's rows by knowing (or guessing) their ids.
// Each helper is tested against a real Postgres database with two users, A
// and B: signed in as A, every helper must refuse B's data even when handed
// B's genuine row ids.
//
// The session is mocked — that is the point. These tests hand the helpers a
// known user id and verify the DATABASE QUERIES cannot cross user boundaries.
// The session/JWT side has its own tests in session.test.ts, and the full
// login flow is covered by the e2e test.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";
import { prisma } from "@/lib/db";

// Controls which user the mocked session reports. null = signed out.
const sessionUser = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("@/lib/session", () => ({
  getCurrentDbUser: async () =>
    sessionUser.id ? { id: sessionUser.id } : null,
  getCurrentUser: async () => (sessionUser.id ? { id: sessionUser.id } : null),
  requireUserId: async () => {
    if (!sessionUser.id) throw new Error("Not authenticated");
    return sessionUser.id;
  },
}));

import * as ownership from "@/lib/ownership";
import {
  findOwnedEvaluation,
  findOwnedPlannedItem,
  findOwnedProjection,
  findOwnedResumeItem,
  findOwnedTargetSchool,
  findPrecedingEvaluationModel,
  CounselorHasNoStudentProfile,
  createOwnStudentProfile,
  isCounselorWithoutOwnStudent,
  getOrCreateProfile,
  getOwnedEvaluations,
  getOwnedPlannedItems,
  getOwnedProjections,
  getOwnedTargets,
  getProfileWithRelations,
  requireOwnedPlannedItem,
  requireOwnedResumeItem,
  requireOwnedTargetSchool,
  requireOwnedTestScore,
} from "@/lib/ownership";

const runTag = makeRunTag("own");

type Fixture = Awaited<ReturnType<typeof seedUser>>;

/** A user with one of everything: resume item, test score, target, evaluation. */
async function seedUser(label: string) {
  const { user, profile } = await createUserWithProfile(runTag, label);
  const [item, score, target, evaluation, plan, projection] = await Promise.all([
    prisma.resumeItem.create({
      data: { profileId: profile.id, type: "project", title: `${label} item` },
    }),
    prisma.testScore.create({
      data: { profileId: profile.id, kind: "sat", label: "SAT", score: "1400" },
    }),
    prisma.targetSchool.create({
      data: { profileId: profile.id, name: `${label} University`, country: "US" },
    }),
    prisma.evaluation.create({
      data: {
        profileId: profile.id,
        status: "completed",
        promptVersion: "evaluation/v4",
        isSample: true,
        inputSnapshotJson: "{}",
      },
    }),
    prisma.plannedItem.create({
      data: {
        profileId: profile.id,
        type: "extracurricular",
        title: `${label} plan`,
      },
    }),
    prisma.projection.create({
      data: {
        profileId: profile.id,
        status: "completed",
        promptVersion: "projection/v1",
        isSample: true,
        inputSnapshotJson: "{}",
      },
    }),
  ]);
  return { user, profile, item, score, target, evaluation, plan, projection };
}

describe.skipIf(!hasTestDb)("ownership helpers", () => {
  let a: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    [a, b] = await Promise.all([seedUser("alice"), seedUser("bob")]);
    sessionUser.id = a.user.id; // signed in as A unless a test says otherwise
  });

  afterAll(async () => {
    sessionUser.id = null;
    await cleanupRun(runTag);
    await prisma.$disconnect();
  });

  describe("signed in as user A", () => {
    it("reads A's own rows", async () => {
      await expect(findOwnedResumeItem(a.item.id)).resolves.toMatchObject({
        id: a.item.id,
      });
      await expect(requireOwnedTestScore(a.score.id)).resolves.toMatchObject({
        id: a.score.id,
      });
      await expect(findOwnedTargetSchool(a.target.id)).resolves.toMatchObject({
        id: a.target.id,
      });
      await expect(findOwnedEvaluation(a.evaluation.id)).resolves.toMatchObject({
        id: a.evaluation.id,
      });
    });

    it("will not read B's evaluation history to report a preceding model", async () => {
      // This helper takes a profileId rather than looking one up, so it is the
      // easiest of the lot to write without an ownership filter. Handed B's
      // real profile id while signed in as A, it must find nothing — otherwise
      // it leaks which model judged another student's run, and confirms that
      // that student exists at all.
      //
      // Both users need a REAL run seeded here: the shared fixture's
      // evaluation is a sample, which this helper skips, so asserting against
      // it would pass whether or not the ownership filter existed.
      const realRun = (profileId: string, model: string) =>
        prisma.evaluation.create({
          data: {
            profileId,
            status: "completed",
            isSample: false,
            model,
            promptVersion: "evaluation/v10",
            inputSnapshotJson: "{}",
            createdAt: new Date(Date.now() - 60 * 60 * 1000),
          },
        });
      await Promise.all([
        realRun(a.profile.id, "model-belonging-to-a"),
        realRun(b.profile.id, "model-belonging-to-b"),
      ]);

      // A's own history reads back — proving the query finds rows at all, so
      // the assertion below is about ownership rather than about an empty table.
      await expect(
        findPrecedingEvaluationModel({
          profileId: a.profile.id,
          createdAt: new Date(),
        }),
      ).resolves.toBe("model-belonging-to-a");

      await expect(
        findPrecedingEvaluationModel({
          profileId: b.profile.id,
          createdAt: new Date(),
        }),
      ).resolves.toBeNull();
    });

    it("refuses B's resume item, even with B's real id", async () => {
      await expect(findOwnedResumeItem(b.item.id)).resolves.toBeNull();
      await expect(requireOwnedResumeItem(b.item.id)).rejects.toThrow(
        "Resume item not found",
      );
    });

    it("refuses B's test score", async () => {
      await expect(requireOwnedTestScore(b.score.id)).rejects.toThrow(
        "Test score not found",
      );
    });

    it("refuses B's target school", async () => {
      await expect(findOwnedTargetSchool(b.target.id)).resolves.toBeNull();
      await expect(requireOwnedTargetSchool(b.target.id)).rejects.toThrow(
        "Target school not found",
      );
    });

    it("refuses B's evaluation", async () => {
      await expect(findOwnedEvaluation(b.evaluation.id)).resolves.toBeNull();
    });

    it("refuses B's planned item", async () => {
      await expect(findOwnedPlannedItem(b.plan.id)).resolves.toBeNull();
      await expect(requireOwnedPlannedItem(b.plan.id)).rejects.toThrow(
        "Planned item not found",
      );
    });

    it("refuses B's projection", async () => {
      await expect(findOwnedProjection(b.projection.id)).resolves.toBeNull();
    });

    it("plan and projection lists contain only A's rows", async () => {
      const plans = await getOwnedPlannedItems();
      expect(plans.map((p) => p.id)).toContain(a.plan.id);
      expect(plans.map((p) => p.id)).not.toContain(b.plan.id);

      const projections = await getOwnedProjections();
      expect(projections.map((p) => p.id)).toContain(a.projection.id);
      expect(projections.map((p) => p.id)).not.toContain(b.projection.id);
    });

    it("lists contain only A's rows, never B's", async () => {
      const targets = await getOwnedTargets();
      expect(targets.map((t) => t.id)).toContain(a.target.id);
      expect(targets.map((t) => t.id)).not.toContain(b.target.id);

      const evaluations = await getOwnedEvaluations();
      expect(evaluations.map((e) => e.id)).toContain(a.evaluation.id);
      expect(evaluations.map((e) => e.id)).not.toContain(b.evaluation.id);
    });

    it("getProfileWithRelations returns A's profile with only A's children", async () => {
      const profile = await getProfileWithRelations();
      expect(profile.id).toBe(a.profile.id);
      expect(profile.resumeItems.map((i) => i.id)).toEqual([a.item.id]);
      expect(profile.testScores.map((s) => s.id)).toEqual([a.score.id]);
      expect(profile.targetSchools.map((t) => t.id)).toEqual([a.target.id]);
    });
  });

  describe("signed out", () => {
    it("every helper refuses to run at all", async () => {
      sessionUser.id = null;
      try {
        await expect(getOrCreateProfile()).rejects.toThrow("Not authenticated");
        await expect(getProfileWithRelations()).rejects.toThrow(
          "Not authenticated",
        );
        await expect(findOwnedResumeItem(a.item.id)).rejects.toThrow(
          "Not authenticated",
        );
        await expect(requireOwnedTestScore(a.score.id)).rejects.toThrow(
          "Not authenticated",
        );
        await expect(findOwnedTargetSchool(a.target.id)).rejects.toThrow(
          "Not authenticated",
        );
        await expect(getOwnedTargets()).rejects.toThrow("Not authenticated");
        await expect(getOwnedEvaluations()).rejects.toThrow("Not authenticated");
        await expect(findOwnedEvaluation(a.evaluation.id)).rejects.toThrow(
          "Not authenticated",
        );
      } finally {
        sessionUser.id = a.user.id;
      }
    });
  });

  describe("first access", () => {
    it("getOrCreateProfile materializes a profile exactly once", async () => {
      // Signup creates only a User; the profile appears on first access.
      const fresh = await prisma.user.create({
        data: {
          email: `${runTag}-fresh@example.test`,
          name: "Fresh",
          passwordHash: "not-a-real-hash",
        },
      });
      sessionUser.id = fresh.id;
      try {
        const first = await getOrCreateProfile();
        expect(first.userId).toBe(fresh.id);
        const second = await getOrCreateProfile();
        expect(second.id).toBe(first.id);
      } finally {
        sessionUser.id = a.user.id;
      }
    });
  });

  // A caseload account opening /dashboard used to be handed a student profile,
  // because resolving one creates one and the student layout resolves one to
  // render its switcher. Nobody asked for it and nobody was told; the counselor
  // simply acquired a student identity on their email. Verified against a real
  // database because the whole bug lives in what the write does.
  describe("a counselor reaching a student surface", () => {
    async function makeCounselor(label: string) {
      return prisma.user.create({
        data: {
          email: `${runTag}-${label}@example.test`,
          name: "Counselor",
          passwordHash: "not-a-real-hash",
          counselorAccount: { create: { type: "INDEPENDENT" } },
        },
      });
    }

    it("is NOT given a student profile for showing up", async () => {
      const counselor = await makeCounselor("cons");
      sessionUser.id = counselor.id;
      try {
        await expect(getOrCreateProfile()).rejects.toThrow(
          CounselorHasNoStudentProfile,
        );
        // The point of the test: nothing was written.
        expect(
          await prisma.profile.count({ where: { userId: counselor.id } }),
        ).toBe(0);
      } finally {
        sessionUser.id = a.user.id;
      }
    });

    it("is recognised as one, so the layout can send them back", async () => {
      const counselor = await makeCounselor("cons2");
      sessionUser.id = counselor.id;
      try {
        expect(await isCounselorWithoutOwnStudent()).toBe(true);
      } finally {
        sessionUser.id = a.user.id;
      }
    });

    it("gets one when they actually ask, and only then", async () => {
      const counselor = await makeCounselor("cons3");
      sessionUser.id = counselor.id;
      try {
        const created = await createOwnStudentProfile();
        expect(created.userId).toBe(counselor.id);
        expect(
          await prisma.profile.count({ where: { userId: counselor.id } }),
        ).toBe(1);
      } finally {
        sessionUser.id = a.user.id;
      }
    });

    it("does not get a second one from a double submit", async () => {
      const counselor = await makeCounselor("cons4");
      sessionUser.id = counselor.id;
      try {
        const first = await createOwnStudentProfile();
        const second = await createOwnStudentProfile();
        expect(second.id).toBe(first.id);
        expect(
          await prisma.profile.count({ where: { userId: counselor.id } }),
        ).toBe(1);
      } finally {
        sessionUser.id = a.user.id;
      }
    });

    it("keeps working normally once it holds one", async () => {
      // A counselor who genuinely keeps their own profile is NOT locked out —
      // bouncing them would strand that data behind a page nothing links to.
      const counselor = await makeCounselor("cons5");
      sessionUser.id = counselor.id;
      try {
        const own = await createOwnStudentProfile();
        expect(await isCounselorWithoutOwnStudent()).toBe(false);
        const resolved = await getOrCreateProfile();
        expect(resolved.id).toBe(own.id);
      } finally {
        sessionUser.id = a.user.id;
      }
    });

    it("leaves an ordinary account's auto-creation alone", async () => {
      // The auto-create is correct for a student signing up — they need a
      // profile and never asked for one either. Only the counselor case changed.
      const student = await prisma.user.create({
        data: {
          email: `${runTag}-ordinary@example.test`,
          name: "Ordinary",
          passwordHash: "not-a-real-hash",
        },
      });
      sessionUser.id = student.id;
      try {
        expect(await isCounselorWithoutOwnStudent()).toBe(false);
        expect((await getOrCreateProfile()).userId).toBe(student.id);
      } finally {
        sessionUser.id = a.user.id;
      }
    });
  });

  // The three profile-level helpers arrived with multi-student accounts, and
  // are exercised in depth in multi-student.test.ts — including that a foreign
  // profile id can neither be resolved as active nor looked up. Repeated here
  // because this file is the one that must fail when a helper is added without
  // an isolation test behind it.
  describe("student profiles", () => {
    it("never returns another account's profile", async () => {
      const a = await createUserWithProfile(runTag, "profile-a");
      const b = await createUserWithProfile(runTag, "profile-b");

      sessionUser.id = a.user.id;
      expect(await ownership.findOwnedProfile(b.profile.id)).toBeNull();
      await expect(
        ownership.requireOwnedProfile(b.profile.id),
      ).rejects.toThrow();
      expect((await ownership.getOwnedProfiles()).map((p) => p.id)).toEqual([
        a.profile.id,
      ]);
    });
  });

  describe("completeness", () => {
    it("covers every exported ownership helper — extend this file when adding one", () => {
      expect(Object.keys(ownership).sort()).toEqual(
        [
          "CounselorHasNoStudentProfile",
          "createOwnStudentProfile",
          "findOwnedEvaluation",
          "findOwnedPlannedItem",
          "findOwnedProfile",
          "findOwnedProjection",
          "findOwnedResumeItem",
          "findOwnedTargetSchool",
          "findPrecedingEvaluationModel",
          "getOrCreateProfile",
          "isCounselorWithoutOwnStudent",
          "getOwnedEvaluations",
          "getOwnedPlannedItems",
          "getOwnedProfiles",
          "getOwnedProjections",
          "getOwnedTargets",
          "getProfileWithRelations",
          "requireOwnedPlannedItem",
          "requireOwnedProfile",
          "requireOwnedResumeItem",
          "requireOwnedTargetSchool",
          "requireOwnedTestScore",
        ].sort(),
      );
    });
  });
});
