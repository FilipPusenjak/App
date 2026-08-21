// Who a counselor can read, and what of.
//
// These are the tests that decide whether this product is shippable. It puts
// one adult professional in front of records belonging to many minors, under
// grants that are narrower than the record and revocable without notice. Every
// property below is enforced in a Prisma query rather than in a component,
// because a UI convention does not survive a new route, a JSON endpoint or a
// debug log — and each one is checked against the DATABASE rather than a mock,
// since the claim is about what leaves Postgres.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("cnsl-access");

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
  findReadableLink,
  listReadableLinks,
  readStudentThroughLink,
  listGrantsForStudent,
  revokeGrant,
  listReadsForStudent,
  scopedProfileInclude,
} = await import("@/lib/counselor/access");

type Fixture = {
  counselorUserId: string;
  counselorAccountId: string;
  studentUserId: string;
  studentProfileId: string;
  linkId: string;
};

describe.skipIf(!hasTestDb)("counselor access", () => {
  let f: Fixture;

  /** A counselor, a student, and a link between them in the given state. */
  async function setup(over: Record<string, unknown> = {}): Promise<Fixture> {
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const counselor = await createUserWithProfile(runTag, `c${suffix}`);
    const student = await createUserWithProfile(runTag, `s${suffix}`);

    const account = await prisma.counselorAccount.create({
      data: { userId: counselor.user.id, orgName: "Test Counseling" },
    });

    // Content of both kinds, so a scope test has something to fail on.
    await prisma.resumeItem.createMany({
      data: [
        {
          profileId: student.profile.id,
          type: "project",
          title: "Orbital mechanics simulation",
        },
        {
          profileId: student.profile.id,
          type: "coursework",
          title: "AP Physics C",
        },
      ],
    });
    await prisma.testScore.create({
      data: { profileId: student.profile.id, kind: "SAT", label: "SAT", score: "1480" },
    });

    const link = await prisma.caseloadLink.create({
      data: {
        counselorAccountId: account.id,
        studentUserId: student.user.id,
        studentProfileId: student.profile.id,
        invitedBy: "COUNSELOR",
        status: "ACTIVE",
        studentConsentAt: new Date(),
        guardianConsentAt: new Date(),
        startedAt: new Date(),
        ...over,
      },
    });

    return {
      counselorUserId: counselor.user.id,
      counselorAccountId: account.id,
      studentUserId: student.user.id,
      studentProfileId: student.profile.id,
      linkId: link.id,
    };
  }

  beforeEach(async () => {
    f = await setup();
    sessionUserId.current = f.counselorUserId;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  describe("dual consent", () => {
    it("reads a fully-consented ACTIVE link", async () => {
      // The positive case first, or every test below could pass by returning
      // nothing for every input.
      const out = await readStudentThroughLink({
        linkId: f.linkId,
        surface: "student.detail",
      });
      expect(out).not.toBeNull();
      expect(out!.profile.id).toBe(f.studentProfileId);
    });

    // These use status ACTIVE deliberately.
    //
    // The first version paired a missing consent with status PENDING, which
    // meant the status check alone rejected them and the consent conditions
    // were never exercised at all — removing both from the query passed every
    // test. A link that is ACTIVE while a consent is missing is precisely the
    // state the consent check exists for: an activation path that ran early, a
    // consent later withdrawn, a bad backfill. If only one condition can hold,
    // it has to be this one.
    it("returns NOTHING when only the student has consented, even if ACTIVE", async () => {
      const only = await setup({ status: "ACTIVE", guardianConsentAt: null });
      sessionUserId.current = only.counselorUserId;

      expect(await findReadableLink(only.linkId)).toBeNull();
      expect(
        await readStudentThroughLink({ linkId: only.linkId, surface: "x" }),
      ).toBeNull();
      expect(await listReadableLinks()).toHaveLength(0);
    });

    it("returns NOTHING when only the guardian has consented, even if ACTIVE", async () => {
      const only = await setup({ status: "ACTIVE", studentConsentAt: null });
      sessionUserId.current = only.counselorUserId;

      expect(await findReadableLink(only.linkId)).toBeNull();
      expect(
        await readStudentThroughLink({ linkId: only.linkId, surface: "x" }),
      ).toBeNull();
      expect(await listReadableLinks()).toHaveLength(0);
    });

    it("returns NOTHING when an ACTIVE link has neither consent", async () => {
      const none = await setup({
        status: "ACTIVE",
        studentConsentAt: null,
        guardianConsentAt: null,
      });
      sessionUserId.current = none.counselorUserId;
      expect(await findReadableLink(none.linkId)).toBeNull();
    });

    it("logs nothing for an ACTIVE link missing a consent", async () => {
      // The read did not happen, so the student's audit log must not suggest
      // it did.
      const only = await setup({ status: "ACTIVE", guardianConsentAt: null });
      sessionUserId.current = only.counselorUserId;
      await readStudentThroughLink({ linkId: only.linkId, surface: "x" });

      sessionUserId.current = only.studentUserId;
      expect(await listReadsForStudent(only.studentProfileId)).toHaveLength(0);
    });

    it("still refuses a PENDING link that has collected both consents", async () => {
      // Consent is necessary and not sufficient — the other half of the pair.
      const pending = await setup({ status: "PENDING" });
      sessionUserId.current = pending.counselorUserId;
      expect(await findReadableLink(pending.linkId)).toBeNull();
    });

    it("returns nothing for a PAUSED link", async () => {
      const paused = await setup({ status: "PAUSED" });
      sessionUserId.current = paused.counselorUserId;
      expect(await findReadableLink(paused.linkId)).toBeNull();
    });

    it("fails closed when endedAt is set but status was not updated", async () => {
      // Belt and braces, deliberately. A revocation writes both fields; a bug
      // writing one should lose access rather than keep it.
      await prisma.caseloadLink.update({
        where: { id: f.linkId },
        data: { endedAt: new Date() },
      });
      expect(await findReadableLink(f.linkId)).toBeNull();
    });
  });

  describe("scope, enforced at the query layer", () => {
    it("ACADEMIC_ONLY cannot reach activity records", async () => {
      // The test the brief asks for by name, and it checks the ROWS rather than
      // the rendering: the activity never leaves Postgres.
      await prisma.caseloadLink.update({
        where: { id: f.linkId },
        data: { scope: "ACADEMIC_ONLY" },
      });

      const out = await readStudentThroughLink({
        linkId: f.linkId,
        surface: "student.detail",
      });
      const titles = out!.profile.resumeItems.map((i) => i.title);
      expect(titles).not.toContain("Orbital mechanics simulation");
      // Coursework is academic and still comes through.
      expect(titles).toContain("AP Physics C");
      // And the academic numbers it exists for do too.
      expect(out!.profile.testScores.length).toBe(1);
    });

    it("ACTIVITIES_ONLY cannot reach grades or test scores", async () => {
      await prisma.caseloadLink.update({
        where: { id: f.linkId },
        data: { scope: "ACTIVITIES_ONLY" },
      });

      const out = await readStudentThroughLink({
        linkId: f.linkId,
        surface: "student.detail",
      });
      expect(out!.profile.testScores).toHaveLength(0);
      // gpa is not even selected, so it is absent rather than null.
      expect("gpa" in out!.profile).toBe(false);
      expect(
        out!.profile.resumeItems.map((i) => i.title),
      ).toContain("Orbital mechanics simulation");
    });

    it("FULL reaches both", async () => {
      const out = await readStudentThroughLink({
        linkId: f.linkId,
        surface: "student.detail",
      });
      expect(out!.profile.resumeItems).toHaveLength(2);
      expect(out!.profile.testScores).toHaveLength(1);
    });

    it("builds a WHERE that excludes rows, not a flag a component may ignore", () => {
      // The property under test is structural: the scope becomes part of the
      // query. A version that returned `true` and left filtering to the caller
      // would pass every behavioural test above only until someone wrote a
      // second caller.
      const academic = scopedProfileInclude("ACADEMIC_ONLY");
      expect(academic.resumeItems).toHaveProperty("where");
      expect(academic.testScores).toBe(true);

      const activities = scopedProfileInclude("ACTIVITIES_ONLY");
      expect(activities.testScores).toHaveProperty("where");
    });
  });

  describe("one counselor cannot reach another's caseload", () => {
    it("does not resolve a link belonging to a different counselor", async () => {
      const other = await setup();
      // Signed in as the FIRST counselor, asking for the second's link.
      sessionUserId.current = f.counselorUserId;

      expect(await findReadableLink(other.linkId)).toBeNull();
      expect(
        await readStudentThroughLink({ linkId: other.linkId, surface: "x" }),
      ).toBeNull();
    });

    it("lists only its own links", async () => {
      await setup();
      sessionUserId.current = f.counselorUserId;
      const links = await listReadableLinks();
      expect(links).toHaveLength(1);
      expect(links[0]!.id).toBe(f.linkId);
    });

    it("gives an account that is not a counselor nothing at all", async () => {
      sessionUserId.current = f.studentUserId;
      expect(await listReadableLinks()).toHaveLength(0);
      expect(await findReadableLink(f.linkId)).toBeNull();
    });
  });

  describe("the student's side", () => {
    it("shows the student who has access and at what scope", async () => {
      sessionUserId.current = f.studentUserId;
      const grants = await listGrantsForStudent();
      expect(grants).toHaveLength(1);
      expect(grants[0]!.scope).toBe("FULL");
      expect(grants[0]!.counselorAccount.orgName).toBe("Test Counseling");
    });

    it("revocation blocks the next counselor read immediately", async () => {
      // Immediate and unilateral. A revocation that waits on the other party
      // is not a revocation.
      sessionUserId.current = f.studentUserId;
      expect(await revokeGrant(f.linkId)).toBe(true);

      sessionUserId.current = f.counselorUserId;
      expect(await findReadableLink(f.linkId)).toBeNull();
      expect(
        await readStudentThroughLink({ linkId: f.linkId, surface: "x" }),
      ).toBeNull();
    });

    it("does not let one account revoke another's grant", async () => {
      const other = await setup();
      sessionUserId.current = f.studentUserId;
      expect(await revokeGrant(other.linkId)).toBe(false);

      // And the other link still works.
      sessionUserId.current = other.counselorUserId;
      expect(await findReadableLink(other.linkId)).not.toBeNull();
    });
  });

  describe("the audit log", () => {
    it("records every read, and the student can see it", async () => {
      sessionUserId.current = f.counselorUserId;
      await readStudentThroughLink({ linkId: f.linkId, surface: "student.detail" });
      await readStudentThroughLink({ linkId: f.linkId, surface: "prep.generate" });

      sessionUserId.current = f.studentUserId;
      const reads = await listReadsForStudent(f.studentProfileId);
      expect(reads).toHaveLength(2);
      expect(reads.map((r) => r.surface).sort()).toEqual([
        "prep.generate",
        "student.detail",
      ]);
      expect(reads[0]!.counselorAccount.orgName).toBe("Test Counseling");
    });

    it("records the scope AS IT WAS, not as it later became", async () => {
      // A link narrowed after the fact must not make an earlier, broader read
      // look narrower than it was — that would be rewriting the record of what
      // someone actually saw.
      sessionUserId.current = f.counselorUserId;
      await readStudentThroughLink({ linkId: f.linkId, surface: "student.detail" });

      await prisma.caseloadLink.update({
        where: { id: f.linkId },
        data: { scope: "ACADEMIC_ONLY" },
      });

      sessionUserId.current = f.studentUserId;
      const reads = await listReadsForStudent(f.studentProfileId);
      expect(reads[0]!.scope).toBe("FULL");
    });

    it("logs a revoked link's earlier reads, which survive the revocation", async () => {
      sessionUserId.current = f.counselorUserId;
      await readStudentThroughLink({ linkId: f.linkId, surface: "student.detail" });

      sessionUserId.current = f.studentUserId;
      await revokeGrant(f.linkId);
      expect(await listReadsForStudent(f.studentProfileId)).toHaveLength(1);
    });

    it("never shows one account another's access history", async () => {
      const other = await setup();
      sessionUserId.current = other.counselorUserId;
      await readStudentThroughLink({ linkId: other.linkId, surface: "student.detail" });

      // A different student's account asking for that profile id.
      sessionUserId.current = f.studentUserId;
      expect(await listReadsForStudent(other.studentProfileId)).toHaveLength(0);
    });

    it("does not log a read that did not happen", async () => {
      // A PENDING link returns nothing, and must not leave a trace suggesting
      // the counselor saw something.
      const pending = await setup({ status: "PENDING" });
      sessionUserId.current = pending.counselorUserId;
      await readStudentThroughLink({ linkId: pending.linkId, surface: "x" });

      sessionUserId.current = pending.studentUserId;
      expect(await listReadsForStudent(pending.studentProfileId)).toHaveLength(0);
    });
  });
});
