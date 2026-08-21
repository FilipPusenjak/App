// Redeeming a student's invite code, against a real database.
//
// The route is exercised directly rather than through a helper, because the
// properties that matter are all about what the DATABASE ends up holding: that
// a code works exactly once, that redeeming it records the student's consent
// and nothing else, and that a counselor who redeems a code still sees nothing
// until a guardian has agreed separately.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("cnsl-invite");

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => {
    if (!sessionUserId.current) throw new Error("Not signed in.");
    return sessionUserId.current;
  },
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { POST } = await import("@/app/api/counselor/links/route");
const { findReadableLink } = await import("@/lib/counselor/access");
const { generateInviteCode, inviteExpiryFrom, formatInviteCode } =
  await import("@/lib/counselor/invite");

function redeem(code: string, scope?: string) {
  return POST(
    new Request("http://localhost/api/counselor/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scope ? { code, scope } : { code }),
    }),
  );
}

describe.skipIf(!hasTestDb)("redeeming an invite code", () => {
  let counselorUserId = "";
  let counselorAccountId = "";

  beforeEach(async () => {
    const counselor = await createUserWithProfile(
      runTag,
      `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    counselorUserId = counselor.user.id;
    const account = await prisma.counselorAccount.create({
      data: { userId: counselor.user.id, orgName: "Invite Test" },
    });
    counselorAccountId = account.id;
    sessionUserId.current = counselorUserId;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  /** A student holding a live code. */
  async function studentWithCode(expiresAt = inviteExpiryFrom(new Date())) {
    const student = await createUserWithProfile(
      runTag,
      `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    );
    const code = generateInviteCode();
    await prisma.profile.update({
      where: { id: student.profile.id },
      data: { counselorInviteCode: code, counselorInviteExpiresAt: expiresAt },
    });
    return { ...student, code };
  }

  it("opens a PENDING link that shows the counselor nothing at all", async () => {
    const student = await studentWithCode();
    const res = await redeem(student.code);
    expect(res.status).toBe(200);

    const link = await prisma.caseloadLink.findFirstOrThrow({
      where: { counselorAccountId, studentProfileId: student.profile.id },
    });
    expect(link.status).toBe("PENDING");
    // The student's own act, recorded. The guardian's, deliberately absent.
    expect(link.studentConsentAt).toBeInstanceOf(Date);
    expect(link.guardianConsentAt).toBeNull();
    expect(link.invitedBy).toBe("STUDENT");

    // And the consequence that matters: nothing is readable yet.
    expect(await findReadableLink(link.id)).toBeNull();
  });

  it("returns nothing about the student it just added", async () => {
    // A PENDING link carries no entitlement, so the response body must not
    // become the leak the consent gate is there to prevent.
    const student = await studentWithCode();
    await prisma.profile.update({
      where: { id: student.profile.id },
      data: { studentName: "Priya Raman", gpa: 3.9, gradeLevel: "Grade 12" },
    });

    const body = JSON.stringify(await (await redeem(student.code)).json());
    expect(body).not.toContain("Priya");
    expect(body).not.toContain("Grade 12");
    expect(body).not.toContain("3.9");
  });

  it("changes nothing on the student's record except the code it consumed", async () => {
    // The source-level guard in tests/unit/counselor-guarantees.test.ts says
    // this write names only the two invite columns. This says the same thing
    // about the row that actually comes back, which is the claim a family
    // would care about.
    const student = await studentWithCode();
    await prisma.profile.update({
      where: { id: student.profile.id },
      data: {
        studentName: "Priya Raman",
        gpa: 3.9,
        gpaScale: "4.0",
        gradeLevel: "Grade 12",
        intendedMajor: "Physics",
        careerGoal: "Research",
      },
    });
    const before = await prisma.profile.findUniqueOrThrow({
      where: { id: student.profile.id },
    });

    await redeem(student.code);

    const after = await prisma.profile.findUniqueOrThrow({
      where: { id: student.profile.id },
    });
    // Compared field by field rather than by a handful of spot checks, so a
    // column added to Profile next year is covered without anyone editing
    // this test.
    const ignored = new Set([
      "counselorInviteCode",
      "counselorInviteExpiresAt",
      "updatedAt",
    ]);
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (ignored.has(key as string)) continue;
      expect({ key, value: after[key] }).toEqual({ key, value: before[key] });
    }
    expect(after.counselorInviteCode).toBeNull();
  });

  it("works exactly once", async () => {
    const student = await studentWithCode();
    expect((await redeem(student.code)).status).toBe(200);

    const second = await redeem(student.code);
    expect(second.status).toBe(404);

    // The code is gone from the profile rather than merely refused.
    const after = await prisma.profile.findUniqueOrThrow({
      where: { id: student.profile.id },
      select: { counselorInviteCode: true, counselorInviteExpiresAt: true },
    });
    expect(after.counselorInviteCode).toBeNull();
    expect(after.counselorInviteExpiresAt).toBeNull();
  });

  it("survives two counselors redeeming the same code at the same moment", async () => {
    // The failure this guards against is two links to one student from a single
    // code — which would double every triage signal and make revocation
    // ambiguous, and which a read-then-write without the transaction allows.
    const student = await studentWithCode();
    const other = await createUserWithProfile(runTag, `race${Date.now()}`);
    const otherAccount = await prisma.counselorAccount.create({
      data: { userId: other.user.id, orgName: "Racer" },
    });

    const results = await Promise.all([
      redeem(student.code),
      (async () => {
        sessionUserId.current = other.user.id;
        const r = await redeem(student.code);
        sessionUserId.current = counselorUserId;
        return r;
      })(),
    ]);

    const ok = results.filter((r) => r.status === 200);
    expect(ok.length).toBe(1);

    const links = await prisma.caseloadLink.count({
      where: { studentProfileId: student.profile.id },
    });
    expect(links).toBe(1);
    expect(otherAccount.id).toBeTruthy();
  });

  it("refuses an expired code with the same message as a wrong one", async () => {
    // Two different messages would be two different facts about whether a code
    // ever existed.
    const expired = await studentWithCode(new Date(Date.now() - 1000));
    const wrong = await redeem(generateInviteCode());
    const stale = await redeem(expired.code);

    expect(stale.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(await stale.json()).toEqual(await wrong.json());
  });

  it("accepts a code the way a person passes it along", async () => {
    const student = await studentWithCode();
    const res = await redeem(
      ` ${formatInviteCode(student.code).toLowerCase()} `,
    );
    expect(res.status).toBe(200);
  });

  it("records the scope the counselor asked for", async () => {
    const student = await studentWithCode();
    await redeem(student.code, "ACADEMIC_ONLY");
    const link = await prisma.caseloadLink.findFirstOrThrow({
      where: { counselorAccountId, studentProfileId: student.profile.id },
    });
    expect(link.scope).toBe("ACADEMIC_ONLY");
  });

  it("does not burn a code when the caseload is already full", async () => {
    // Checked BEFORE redemption, so a counselor at their limit does not consume
    // a student's single-use code to find out.
    await prisma.counselorAccount.update({
      where: { id: counselorAccountId },
      data: { caseloadLimit: 0 },
    });
    const student = await studentWithCode();

    const res = await redeem(student.code);
    expect(res.status).toBe(402);

    const after = await prisma.profile.findUniqueOrThrow({
      where: { id: student.profile.id },
      select: { counselorInviteCode: true },
    });
    expect(after.counselorInviteCode).toBe(student.code);
  });

  it("does not carry an old guardian consent into a revived link", async () => {
    // A guardian agreed to a grant that was later ended. Reviving it must ask
    // again rather than inherit an agreement about a relationship that stopped.
    const student = await studentWithCode();
    await redeem(student.code);
    const linkId = (
      await prisma.caseloadLink.findFirstOrThrow({
        where: { counselorAccountId, studentProfileId: student.profile.id },
      })
    ).id;
    await prisma.caseloadLink.update({
      where: { id: linkId },
      data: {
        status: "ENDED",
        endedAt: new Date(),
        guardianConsentAt: new Date(),
      },
    });

    const fresh = generateInviteCode();
    await prisma.profile.update({
      where: { id: student.profile.id },
      data: {
        counselorInviteCode: fresh,
        counselorInviteExpiresAt: inviteExpiryFrom(new Date()),
      },
    });
    expect((await redeem(fresh)).status).toBe(200);

    const revived = await prisma.caseloadLink.findUniqueOrThrow({
      where: { id: linkId },
    });
    expect(revived.status).toBe("PENDING");
    expect(revived.guardianConsentAt).toBeNull();
    expect(revived.endedAt).toBeNull();
    expect(await findReadableLink(linkId)).toBeNull();
  });

  it("refuses an account that is not a counselor", async () => {
    const stranger = await createUserWithProfile(runTag, `x${Date.now()}`);
    const student = await studentWithCode();
    sessionUserId.current = stranger.user.id;

    const res = await redeem(student.code);
    expect(res.status).toBe(403);

    sessionUserId.current = counselorUserId;
    const after = await prisma.profile.findUniqueOrThrow({
      where: { id: student.profile.id },
      select: { counselorInviteCode: true },
    });
    expect(after.counselorInviteCode).toBe(student.code);
  });
});
