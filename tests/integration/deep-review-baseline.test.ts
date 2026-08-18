// Which stored row a tier treats as its baseline — proved against a database,
// because the fault was in a Prisma `where` and a column default.
//
// Evaluation.type defaults to "DEEP_REVIEW". That default is invisible in
// application code and shows up only in stored rows, which is why a unit test
// over hand-written objects can pin the rule but not the query. Here the
// legacy row is written the way the legacy route writes it — no explicit type
// at all — so the default does the same thing to the test that it did in
// production.
//
// The bug this pins: an account whose only history was a legacy percentile
// evaluation was told its last Deep Review was less than 21 days ago, and was
// refused its FIRST one for three weeks.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("baseline");

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadForTier } = await import("@/lib/evaluation/tier-load");
const { checkDeepReviewAllowed } = await import("@/lib/evaluation/tier-access");
const { DEEP_REVIEW_PROMPT_VERSION } = await import(
  "@/lib/prompts/tiers/deep-review-v3"
);
const { CHECK_IN_PROMPT_VERSION } = await import(
  "@/lib/prompts/tiers/check-in-v3"
);

describe.skipIf(!hasTestDb)("what counts as the preceding run for a tier", () => {
  let profileId = "";

  beforeEach(async () => {
    const { user, profile } = await createUserWithProfile(
      runTag,
      `u${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    sessionUserId.current = user.id;
    profileId = profile.id;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  /** A percentile evaluation, written exactly as the legacy route writes one. */
  async function writeLegacyEvaluation() {
    return prisma.evaluation.create({
      data: {
        profileId,
        // No `type`. That is the point: the column default supplies
        // "DEEP_REVIEW" here, the same way it did for every row already in the
        // production database.
        status: "completed",
        completedAt: new Date(),
        promptVersion: "evaluation/v6",
        rubricVersion: "readiness/v1",
        overallScore: 68,
        resultJson: JSON.stringify({ overallScore: 68 }),
      },
    });
  }

  async function writeDeepReview() {
    return prisma.evaluation.create({
      data: {
        profileId,
        type: "DEEP_REVIEW",
        status: "completed",
        completedAt: new Date(),
        promptVersion: DEEP_REVIEW_PROMPT_VERSION,
        rubricVersion: "readiness/v1",
        paceStatus: "ON_PACE",
        thresholdSnapshotJson: JSON.stringify({ band: "mostly met", schools: [] }),
        differentiationSnapshotJson: JSON.stringify({
          band: "developing",
          rungs: {},
        }),
        resultJson: JSON.stringify({ sinceLastReview: "Baseline." }),
      },
    });
  }

  it("stores the default type on a legacy row, which is why type is not enough", async () => {
    // Stated outright, so the premise of every test below is checked rather
    // than assumed. If this default is ever removed, these tests should be
    // reread, not silently kept.
    const legacy = await writeLegacyEvaluation();
    const row = await prisma.evaluation.findUniqueOrThrow({
      where: { id: legacy.id },
    });
    expect(row.type).toBe("DEEP_REVIEW");
    expect(row.promptVersion).toBe("evaluation/v6");
  });

  it("does not treat a legacy evaluation as the preceding deep review", async () => {
    await writeLegacyEvaluation();
    const data = await loadForTier("DEEP_REVIEW");
    expect(data.preceding).toBeNull();
  });

  it("lets the first deep review through when only legacy runs exist", async () => {
    // The user-visible bug, end to end: load the baseline the route loads, ask
    // the gate the route asks.
    await writeLegacyEvaluation();
    const data = await loadForTier("DEEP_REVIEW");
    const gate = checkDeepReviewAllowed({
      tier: "PAID",
      lastDeepReviewAt: data.preceding?.createdAt ?? null,
    });
    expect(gate.allowed).toBe(true);
  });

  it("holds the 21-day floor once a real deep review exists", async () => {
    // The other half. A fix that let every Deep Review through would pass the
    // test above and destroy the feature.
    const review = await writeDeepReview();
    const data = await loadForTier("DEEP_REVIEW");
    expect(data.preceding?.id).toBe(review.id);

    const gate = checkDeepReviewAllowed({
      tier: "PAID",
      lastDeepReviewAt: data.preceding?.createdAt ?? null,
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reason).toBe("interval");
  });

  it("prefers the real deep review over a newer legacy row", async () => {
    // Ordering cannot rescue this: the legacy row is the most recent, and the
    // baseline must still be the review.
    const review = await writeDeepReview();
    await new Promise((r) => setTimeout(r, 5));
    await writeLegacyEvaluation();

    const data = await loadForTier("DEEP_REVIEW");
    expect(data.preceding?.id).toBe(review.id);
  });

  it("does not treat a check-in as the preceding deep review", async () => {
    await prisma.evaluation.create({
      data: {
        profileId,
        type: "CHECK_IN",
        status: "completed",
        completedAt: new Date(),
        promptVersion: CHECK_IN_PROMPT_VERSION,
        rubricVersion: "readiness/v1",
        resultJson: JSON.stringify({ changed: true }),
      },
    });
    const data = await loadForTier("DEEP_REVIEW");
    expect(data.preceding).toBeNull();
  });

  it("still finds a no-change check-in, which stores no promptVersion", async () => {
    // The reason CHECK_IN deliberately has no promptVersion guard. Requiring
    // one would drop exactly the rows the next check-in measures against, and
    // a student who changed nothing for a fortnight would be compared to
    // whatever ran before that instead.
    const quiet = await prisma.evaluation.create({
      data: {
        profileId,
        type: "CHECK_IN",
        status: "completed",
        completedAt: new Date(),
        rubricVersion: "readiness/v1",
        resultJson: JSON.stringify({ changed: false }),
      },
    });
    expect(quiet.promptVersion).toBeNull();

    const data = await loadForTier("CHECK_IN");
    expect(data.preceding?.id).toBe(quiet.id);
  });
});
