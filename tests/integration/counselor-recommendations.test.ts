// What a counselor did with the drafted advice, and the parity that makes the
// whole product credible.
//
// Two separate claims live in this file because both are about the boundary
// between the two surfaces:
//
//   A counselor's decisions are scoped to their own caseload, like every other
//   counselor read, and are recorded rather than acted on.
//
//   A counselor and a student see THE SAME NUMBERS. If a counselor's screen
//   said "unmet" while the student's said "on track", the product would fail in
//   the way it cannot recover from — in front of a family, in a paid session.
//   Checked against a real database, because the claim is that two different
//   code paths over the same rows agree.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("cnsl-recs");

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => {
    if (!sessionUserId.current) throw new Error("Not signed in.");
    return sessionUserId.current;
  },
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  setRecommendationStatus,
  loadFollowThroughPatterns,
  loadRecommendationsForPrep,
} = await import("@/lib/counselor/recommendations");
const { buildPrepContext } = await import("@/lib/counselor/prep/context");
const { findReadableLink } = await import("@/lib/counselor/access");
const { loadForTier } = await import("@/lib/evaluation/tier-load");

const NOW = new Date("2026-10-15T00:00:00Z");

describe.skipIf(!hasTestDb)("counselor recommendations", () => {
  let counselorUserId = "";
  let counselorAccountId = "";

  beforeEach(async () => {
    const counselor = await createUserWithProfile(
      runTag,
      `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    counselorUserId = counselor.user.id;
    const account = await prisma.counselorAccount.create({
      data: { userId: counselor.user.id, orgName: "Recs Test" },
    });
    counselorAccountId = account.id;
    sessionUserId.current = counselorUserId;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  async function linkStudent(
    accountId = counselorAccountId,
    profile: Record<string, unknown> = {},
  ) {
    const student = await createUserWithProfile(
      runTag,
      `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    );
    if (Object.keys(profile).length > 0) {
      await prisma.profile.update({
        where: { id: student.profile.id },
        data: profile,
      });
    }
    const link = await prisma.caseloadLink.create({
      data: {
        counselorAccountId: accountId,
        studentUserId: student.user.id,
        studentProfileId: student.profile.id,
        invitedBy: "COUNSELOR",
        status: "ACTIVE",
        studentConsentAt: NOW,
        guardianConsentAt: NOW,
        startedAt: NOW,
      },
    });
    return { ...student, linkId: link.id };
  }

  async function makePrep(linkId: string, accountId = counselorAccountId) {
    return prisma.sessionPrep.create({
      data: {
        caseloadLinkId: linkId,
        counselorAccountId: accountId,
        rubricVersion: "test/v1",
      },
    });
  }

  async function propose(linkId: string, prepId: string, text = "Sit the exam externally.") {
    return prisma.counselorRecommendation.create({
      data: {
        caseloadLinkId: linkId,
        sessionPrepId: prepId,
        text,
        basis: "threshold.newly_binding",
        source: "MODEL_SUGGESTED",
        status: "PROPOSED",
      },
    });
  }

  describe("who may decide what", () => {
    it("records a delivery, with when", async () => {
      const student = await linkStudent();
      const prep = await makePrep(student.linkId);
      const rec = await propose(student.linkId, prep.id);

      expect(await setRecommendationStatus({ recommendationId: rec.id, next: "DELIVERED" })).toEqual({ ok: true });

      const after = await prisma.counselorRecommendation.findUniqueOrThrow({
        where: { id: rec.id },
      });
      expect(after.status).toBe("DELIVERED");
      expect(after.deliveredAt).toBeInstanceOf(Date);
    });

    it("records what a professional chose NOT to pass on, and why", async () => {
      // The reason this table exists. Everything else here could be inferred
      // from the prep; this could not.
      const student = await linkStudent();
      const prep = await makePrep(student.linkId);
      const rec = await propose(student.linkId, prep.id);

      await setRecommendationStatus({
        recommendationId: rec.id,
        next: "DECLINED_BY_COUNSELOR",
        declineReason: "Their mother is ill; this is not the term for it.",
      });

      const after = await prisma.counselorRecommendation.findUniqueOrThrow({
        where: { id: rec.id },
      });
      expect(after.status).toBe("DECLINED_BY_COUNSELOR");
      expect(after.declineReason).toContain("not the term for it");
    });

    it("does not let a counselor mark their own advice as accepted by the student", async () => {
      // A counselor writing ACCEPTED_BY_STUDENT would be recording an outcome
      // that never happened, in the one table meant to record what did.
      const student = await linkStudent();
      const prep = await makePrep(student.linkId);
      const rec = await propose(student.linkId, prep.id);

      const result = await setRecommendationStatus({
        recommendationId: rec.id,
        next: "ACCEPTED_BY_STUDENT",
      });
      expect(result.ok).toBe(false);

      const after = await prisma.counselorRecommendation.findUniqueOrThrow({
        where: { id: rec.id },
      });
      expect(after.status).toBe("PROPOSED");
    });

    it("cannot rewrite a decision already made", async () => {
      const student = await linkStudent();
      const prep = await makePrep(student.linkId);
      const rec = await propose(student.linkId, prep.id);

      await setRecommendationStatus({ recommendationId: rec.id, next: "DECLINED_BY_COUNSELOR" });
      const second = await setRecommendationStatus({ recommendationId: rec.id, next: "DELIVERED" });
      expect(second.ok).toBe(false);
    });

    it("does not find another counselor's recommendation", async () => {
      const otherCounselor = await createUserWithProfile(runTag, `other${Date.now()}`);
      const otherAccount = await prisma.counselorAccount.create({
        data: { userId: otherCounselor.user.id, orgName: "Somebody Else" },
      });
      const theirStudent = await linkStudent(otherAccount.id);
      const theirPrep = await makePrep(theirStudent.linkId, otherAccount.id);
      const theirRec = await propose(theirStudent.linkId, theirPrep.id);

      // Signed in as OUR counselor, holding a valid id from theirs.
      const result = await setRecommendationStatus({
        recommendationId: theirRec.id,
        next: "DELIVERED",
      });
      expect(result).toEqual({ ok: false, reason: "Not found." });

      const untouched = await prisma.counselorRecommendation.findUniqueOrThrow({
        where: { id: theirRec.id },
      });
      expect(untouched.status).toBe("PROPOSED");
    });

    it("stops finding its own recommendations the moment the student revokes", async () => {
      const student = await linkStudent();
      const prep = await makePrep(student.linkId);
      const rec = await propose(student.linkId, prep.id);

      await prisma.caseloadLink.update({
        where: { id: student.linkId },
        data: { status: "ENDED", endedAt: new Date() },
      });

      expect(await setRecommendationStatus({ recommendationId: rec.id, next: "DELIVERED" })).toEqual({
        ok: false,
        reason: "Not found.",
      });
      expect(await loadRecommendationsForPrep(prep.id)).toEqual([]);
    });

    it("stops finding them when a consent lapses, without the link changing status", async () => {
      // The status check alone would pass here. Dual consent is a separate
      // condition and has to fail this on its own.
      const student = await linkStudent();
      const prep = await makePrep(student.linkId);
      const rec = await propose(student.linkId, prep.id);

      await prisma.caseloadLink.update({
        where: { id: student.linkId },
        data: { guardianConsentAt: null },
      });

      expect(await setRecommendationStatus({ recommendationId: rec.id, next: "DELIVERED" })).toEqual({
        ok: false,
        reason: "Not found.",
      });
    });
  });

  describe("patterns, not performance", () => {
    it("says nothing at all below the sample floor", async () => {
      const student = await linkStudent();
      const prep = await makePrep(student.linkId);
      for (let i = 0; i < 7; i++) {
        await propose(student.linkId, prep.id, `Option ${i}`);
      }
      // Seven is a coincidence with a percentage attached.
      expect(await loadFollowThroughPatterns()).toEqual([]);
    });

    it("observes what happened to the advice, in counts rather than a score", async () => {
      const student = await linkStudent();
      const prep = await makePrep(student.linkId);
      for (let i = 0; i < 10; i++) {
        const rec = await propose(student.linkId, prep.id, `Option ${i}`);
        if (i < 6) {
          await setRecommendationStatus({
            recommendationId: rec.id,
            next: "DECLINED_BY_COUNSELOR",
          });
        }
      }

      const patterns = await loadFollowThroughPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      const declined = patterns.find((p) => p.detail.includes("declined"));
      expect(declined?.detail).toBe("6 of 10 were declined before delivery.");

      // Nothing anywhere in the output reads as a judgement of the person.
      const text = patterns.map((p) => `${p.observation} ${p.detail}`).join(" ");
      expect(text).not.toMatch(/score|rating|effectiveness|success rate|%/i);
    });

    it("counts only this counselor's own caseload", async () => {
      const otherCounselor = await createUserWithProfile(runTag, `o2${Date.now()}`);
      const otherAccount = await prisma.counselorAccount.create({
        data: { userId: otherCounselor.user.id, orgName: "Somebody Else" },
      });
      const theirStudent = await linkStudent(otherAccount.id);
      const theirPrep = await makePrep(theirStudent.linkId, otherAccount.id);
      for (let i = 0; i < 12; i++) {
        await propose(theirStudent.linkId, theirPrep.id, `Theirs ${i}`);
      }

      // Our counselor has none of their own, so twelve next door must not
      // become twelve of ours.
      expect(await loadFollowThroughPatterns()).toEqual([]);
    });
  });

  describe("a counselor and a student see the same numbers", () => {
    /**
     * The parity that makes the counselor edition credible.
     *
     * Both surfaces are driven here over the SAME profile rows: the student
     * path through loadForTier, the counselor path through buildPrepContext.
     * The prep context is what the model is given, so if these disagreed the
     * disagreement would reach a session.
     */
    it("computes identical standing on both paths at the same rubric version", async () => {
      const student = await linkStudent(counselorAccountId, {
        gradeLevel: "Grade 11",
        gpa: 3.7,
        gpaScale: "4.0",
        curriculum: "AP",
        intendedMajor: "Physics",
        graduationYear: 2028,
      });
      await prisma.resumeItem.createMany({
        data: [
          { profileId: student.profile.id, type: "coursework", title: "AP Physics C" },
          { profileId: student.profile.id, type: "coursework", title: "AP Calculus BC" },
          {
            profileId: student.profile.id,
            type: "extracurricular",
            title: "Robotics team",
            hoursPerWeek: 6,
            rungLevel: "contributor",
            startDate: new Date("2025-09-01T00:00:00Z"),
          },
        ],
      });
      await prisma.testScore.create({
        data: { profileId: student.profile.id, kind: "SAT", label: "SAT", score: "1480" },
      });
      await prisma.targetSchool.create({
        data: {
          profileId: student.profile.id,
          name: "Imperial College London",
          country: "GB",
          course: "Physics",
        },
      });

      // The student's own screen, computed as the student.
      sessionUserId.current = student.user.id;
      const asStudent = await loadForTier("DEEP_REVIEW");

      // The counselor's prep context, computed as the counselor.
      sessionUserId.current = counselorUserId;
      const link = await findReadableLink(student.linkId);
      expect(link).not.toBeNull();
      const context = await buildPrepContext(link!, NOW);

      expect(context.rubricVersion).toBe(asStudent.scored.rubricVersion);

      // Read back out of the prompt itself rather than out of an intermediate
      // object: the prompt is what actually reaches the model, and a value that
      // agreed internally but was rendered differently would still be wrong on
      // the counselor's screen.
      const standing = Object.fromEntries(
        [...context.text.matchAll(/^- ([^:\n]+): (.+)$/gm)].map((m) => [m[1]!, m[2]!]),
      );
      expect(standing["Rubric version"]).toBe(asStudent.scored.rubricVersion);
      expect(standing["Requirements band"]).toBe(asStudent.scored.thresholdBand);
      expect(standing["Differentiation band"]).toBe(
        asStudent.scored.differentiation.band,
      );
      expect(standing["Pace"]).toBe(asStudent.scored.pace.status);
      if (asStudent.scored.monthsUntilApplication != null) {
        expect(standing["Months until applications"]).toBe(
          String(asStudent.scored.monthsUntilApplication),
        );
      }
    });

    it("carries no readiness number into the prep context at all", async () => {
      // Bands and pace are shared; a percentile is not. The counselor surface
      // states standing, never a rank.
      const student = await linkStudent(counselorAccountId, {
        gradeLevel: "Grade 12",
        gpa: 3.9,
        gpaScale: "4.0",
      });
      const link = await findReadableLink(student.linkId);
      const context = await buildPrepContext(link!, NOW);
      expect(context.text).not.toMatch(/percentile|readiness score|\brank(ed|ing)?\b/i);
    });
  });
});
