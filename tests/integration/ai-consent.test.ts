// Nothing goes to the AI provider without the data subject's permission.
//
// Run through the real routes against a real database, with only the model
// stubbed — and the stub counts calls, because "refused" has to mean the
// request was never constructed, not that it was sent and its answer dropped.
//
// The counselor case is the one worth the file. A counselor's prep sends a
// STUDENT's data on the COUNSELOR's click, so the counselor having allowed AI
// on their own account must not be enough. The tutor equivalent lives in
// testprep-artifact-route.test.ts beside the rest of that route's tests.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("ai-consent");
const d = hasTestDb ? describe : describe.skip;

const session = { userId: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => session.userId,
  getCurrentUser: async () => ({ id: session.userId, email: "x@example.test" }),
  getCurrentDbUser: async () => ({ id: session.userId, email: "x@example.test" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const modelCalls = vi.fn();
vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  const call = async () => {
    modelCalls();
    throw new Error("the model must not be reached in these tests");
  };
  return {
    ...actual,
    getAnthropicClient: () => ({
      messages: {
        create: call,
        stream: () => ({ finalMessage: call }),
        parse: call,
      },
    }),
  };
});

const evaluate = (await import("@/app/api/evaluate/route")).POST;
const project = (await import("@/app/api/project/route")).POST;
const checkIn = (await import("@/app/api/evaluations/check-in/route")).POST;
const prep = (await import("@/app/api/counselor/prep/route")).POST;
const { setAiConsentAction } = await import("@/app/actions/ai-consent");

let seq = 0;
const uniq = () => `u${seq++}`;

async function studentWithoutConsent() {
  const made = await createUserWithProfile(runTag, uniq(), { aiConsent: false });
  await prisma.user.update({
    where: { id: made.user.id },
    data: { activeProfileId: made.profile.id },
  });
  session.userId = made.user.id;
  return made;
}

d("asking before sending a student's data to the AI provider", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
    modelCalls.mockClear();
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("refuses a Deep Review, and records no run", async () => {
    const { profile } = await studentWithoutConsent();

    const res = await evaluate(
      new Request("http://localhost/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ full: false }),
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("AI_CONSENT_REQUIRED");
    expect(modelCalls).not.toHaveBeenCalled();
    expect(await prisma.evaluation.count({ where: { profileId: profile.id } })).toBe(0);
  });

  it("refuses a check-in", async () => {
    await studentWithoutConsent();
    const res = await checkIn();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("AI_CONSENT_REQUIRED");
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it("refuses a projection, and records no run", async () => {
    const { profile } = await studentWithoutConsent();
    const res = await project();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("AI_CONSENT_REQUIRED");
    expect(modelCalls).not.toHaveBeenCalled();
    expect(await prisma.projection.count({ where: { profileId: profile.id } })).toBe(0);
  });

  it("refuses a counselor's prep when the STUDENT has not allowed it", async () => {
    const student = await createUserWithProfile(runTag, uniq(), { aiConsent: false });
    // The counselor has allowed AI on their own account — the fixture default.
    const counselor = await createUserWithProfile(runTag, uniq());
    const account = await prisma.counselorAccount.create({
      data: { userId: counselor.user.id, orgName: `Org ${uniq()}` },
    });
    const now = new Date();
    const link = await prisma.caseloadLink.create({
      data: {
        counselorAccountId: account.id,
        studentUserId: student.user.id,
        studentProfileId: student.profile.id,
        invitedBy: "STUDENT",
        status: "ACTIVE",
        studentConsentAt: now,
        guardianConsentAt: now,
        startedAt: now,
      },
    });
    session.userId = counselor.user.id;

    const res = await prep(
      new Request("http://localhost/api/counselor/prep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkId: link.id }),
      }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("STUDENT_AI_CONSENT_REQUIRED");
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it("records when permission was first given, and withdrawing clears it", async () => {
    const { user } = await studentWithoutConsent();

    await setAiConsentAction(true);
    const first = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .aiConsentAt;
    expect(first).toBeInstanceOf(Date);

    // A second "allow" is not a new agreement and must not move the date.
    await setAiConsentAction(true);
    const again = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .aiConsentAt;
    expect(again?.getTime()).toBe(first!.getTime());

    await setAiConsentAction(false);
    const after = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .aiConsentAt;
    expect(after).toBeNull();
  });

  it("never sets permission on any account but the signed-in one", async () => {
    const other = await createUserWithProfile(runTag, uniq(), { aiConsent: false });
    await studentWithoutConsent();
    await setAiConsentAction(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } });
    expect(row.aiConsentAt).toBeNull();
  });
});
