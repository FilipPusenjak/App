// A check-in the model declines — run through the real route.
//
// Opus 5.5 declines on a broader set of categories than Opus 5 did, which is
// what made this path worth closing. Before, the route never read stop_reason:
// a refusal came back as empty text, failed the parse, and was RETRIED with a
// correction appended — a second paid request for something the model had
// already declined outright, and no more likely to succeed.
//
// What is proven here, against a real database: one request, not two; the row
// is completed as failed rather than left pending; and the student gets the run
// back, because a refusal is not something they did.
//
// Only the model call is stubbed. Session, quota, rate limiting, materiality
// and the failure bookkeeping are the real ones.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("checkin-refusal");
const d = hasTestDb ? describe : describe.skip;

const session = { userId: "", email: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => session.userId,
  getCurrentUser: async () => ({ id: session.userId, email: session.email }),
  getCurrentDbUser: async () => ({ id: session.userId, email: session.email }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

/** What the stubbed model does next, and every request it was sent. */
const stub = {
  stopReason: "refusal" as string,
  text: "",
  requests: [] as { model: string }[],
};

vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...actual,
    getAnthropicClient: () => ({
      messages: {
        create: async (args: { model: string }) => {
          stub.requests.push({ model: args.model });
          return {
            stop_reason: stub.stopReason,
            content: stub.text ? [{ type: "text", text: stub.text }] : [],
            usage: { input_tokens: 4_000, output_tokens: 12 },
          };
        },
      },
    }),
  };
});

const { POST } = await import("@/app/api/evaluations/check-in/route");

/** A student with something reported and unread — which makes a check-in material. */
async function studentWithNews() {
  const made = await createUserWithProfile(runTag, `s${Date.now()}${Math.random().toString(36).slice(2, 7)}`);
  await prisma.profile.update({
    where: { id: made.profile.id },
    data: { studentName: "Test Student", gradeLevel: "Grade 11" },
  });
  await prisma.user.update({
    where: { id: made.user.id },
    data: { activeProfileId: made.profile.id },
  });
  await prisma.development.create({
    data: {
      profileId: made.profile.id,
      body: "Started volunteering at the food bank on Saturdays.",
    },
  });
  session.userId = made.user.id;
  session.email = made.user.email;
  return made;
}

d("a check-in the model declines", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
    stub.stopReason = "refusal";
    stub.text = "";
    stub.requests = [];
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("sends one request, not two — a refusal is not retried", async () => {
    await studentWithNews();

    await POST();

    expect(stub.requests).toHaveLength(1);
  });

  it("completes the run as failed rather than leaving it pending", async () => {
    const { profile } = await studentWithNews();

    const response = await POST();

    expect(response.ok).toBe(false);
    const row = await prisma.evaluation.findFirstOrThrow({
      where: { profileId: profile.id, type: "CHECK_IN" },
    });
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/declined/i);
  });

  it("gives the student the run back, because a refusal is not their doing", async () => {
    const { profile } = await studentWithNews();

    await POST();

    const row = await prisma.evaluation.findFirstOrThrow({
      where: { profileId: profile.id, type: "CHECK_IN" },
    });
    expect(row.quotaRefunded).toBe(true);
  });

  it("still records what the declined request cost", async () => {
    // Tokens are spent before anything can reject the answer.
    const { profile } = await studentWithNews();

    await POST();

    const row = await prisma.evaluation.findFirstOrThrow({
      where: { profileId: profile.id, type: "CHECK_IN" },
    });
    expect(row.inputTokens).toBe(4_000);
  });

  it("runs on the full model, not a hardcoded cheaper one", async () => {
    // A check-in is an evaluation, and with no follow-up model configured
    // every evaluation runs on the full model. The route used to fall back to
    // Sonnet here regardless.
    vi.stubEnv("ANTHROPIC_MODEL", "");
    vi.stubEnv("ANTHROPIC_FOLLOWUP_MODEL", "");
    await studentWithNews();

    await POST();

    expect(stub.requests[0]?.model).toBe("claude-opus-5-5");
    vi.unstubAllEnvs();
  });
});
