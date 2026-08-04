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
          "findOwnedEvaluation",
          "findOwnedPlannedItem",
          "findOwnedProfile",
          "findOwnedProjection",
          "findOwnedResumeItem",
          "findOwnedTargetSchool",
          "getOrCreateProfile",
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
