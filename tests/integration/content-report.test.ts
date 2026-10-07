// Reporting AI-generated content from inside the app.
//
// The rule that needs a database to prove: you can only report what you can
// see. Without it the action is an id oracle and a way to stuff the queue.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("content-report");
const d = hasTestDb ? describe : describe.skip;

const session = { userId: "", email: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => session.userId,
  getCurrentUser: async () => ({ id: session.userId, email: session.email }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { reportContentAction, resolveContentReportAction } = await import(
  "@/app/actions/content-report"
);

let seq = 0;
const uniq = () => `u${seq++}`;

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function studentWithEvaluation() {
  const made = await createUserWithProfile(runTag, uniq());
  const evaluation = await prisma.evaluation.create({
    data: { profileId: made.profile.id, status: "completed", resultJson: "{}" },
  });
  return { ...made, evaluation };
}

d("reporting AI-generated content", () => {
  beforeEach(async () => {
    await cleanupRun(runTag);
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("records a report on your own evaluation", async () => {
    const { user, evaluation } = await studentWithEvaluation();
    session.userId = user.id;

    const result = await reportContentAction(
      undefined,
      form({
        kind: "EVALUATION",
        targetId: evaluation.id,
        reason: "OFFENSIVE",
        details: "It called my essay pathetic.",
      }),
    );

    expect(result).toEqual({ ok: true });
    const rows = await prisma.contentReport.findMany({
      where: { reporterUserId: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "EVALUATION",
      targetId: evaluation.id,
      reason: "OFFENSIVE",
      details: "It called my essay pathetic.",
      resolvedAt: null,
    });
  });

  it("refuses someone else's evaluation exactly like a missing one", async () => {
    const owner = await studentWithEvaluation();
    const stranger = await createUserWithProfile(runTag, uniq());
    session.userId = stranger.user.id;

    const theirs = await reportContentAction(
      undefined,
      form({ kind: "EVALUATION", targetId: owner.evaluation.id, reason: "OTHER" }),
    );
    const missing = await reportContentAction(
      undefined,
      form({ kind: "EVALUATION", targetId: "does-not-exist", reason: "OTHER" }),
    );

    expect(theirs).toEqual(missing);
    expect(await prisma.contentReport.count({ where: { targetId: owner.evaluation.id } })).toBe(0);
  });

  it("rejects an unknown kind or reason", async () => {
    const { user, evaluation } = await studentWithEvaluation();
    session.userId = user.id;

    expect(
      await reportContentAction(
        undefined,
        form({ kind: "PROFILE", targetId: evaluation.id, reason: "OTHER" }),
      ),
    ).toHaveProperty("error");
    expect(
      await reportContentAction(
        undefined,
        form({ kind: "EVALUATION", targetId: evaluation.id, reason: "BORING" }),
      ),
    ).toHaveProperty("error");
    expect(await prisma.contentReport.count({ where: { reporterUserId: user.id } })).toBe(0);
  });

  it("updates an open report rather than adding a second one", async () => {
    const { user, evaluation } = await studentWithEvaluation();
    session.userId = user.id;
    const base = { kind: "EVALUATION", targetId: evaluation.id };

    await reportContentAction(undefined, form({ ...base, reason: "OTHER" }));
    await reportContentAction(
      undefined,
      form({ ...base, reason: "INACCURATE", details: "Wrong deadline." }),
    );

    const rows = await prisma.contentReport.findMany({ where: { reporterUserId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "INACCURATE", details: "Wrong deadline." });
  });

  it("lets only an operator resolve a report", async () => {
    const { user, evaluation } = await studentWithEvaluation();
    session.userId = user.id;
    session.email = user.email;
    await reportContentAction(
      undefined,
      form({ kind: "EVALUATION", targetId: evaluation.id, reason: "HARMFUL" }),
    );
    const report = await prisma.contentReport.findFirstOrThrow({
      where: { reporterUserId: user.id },
    });

    vi.stubEnv("OPERATOR_EMAILS", "operator@example.test");
    await resolveContentReportAction(form({ id: report.id }));
    expect(
      (await prisma.contentReport.findUniqueOrThrow({ where: { id: report.id } })).resolvedAt,
    ).toBeNull();

    session.email = "operator@example.test";
    await resolveContentReportAction(form({ id: report.id }));
    expect(
      (await prisma.contentReport.findUniqueOrThrow({ where: { id: report.id } })).resolvedAt,
    ).toBeInstanceOf(Date);
  });

  it("goes when the reporter's account is deleted", async () => {
    const { user, evaluation } = await studentWithEvaluation();
    session.userId = user.id;
    await reportContentAction(
      undefined,
      form({ kind: "EVALUATION", targetId: evaluation.id, reason: "OTHER" }),
    );
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.contentReport.count({ where: { reporterUserId: user.id } })).toBe(0);
  });
});
