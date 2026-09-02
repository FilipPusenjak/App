// A tier run that spends money and produces nothing usable.
//
// Both tier routes can fail AFTER the model has been called: the output does
// not satisfy its schema, or it contains phrasing the app refuses to show a
// student. Discarding that output is correct. Discarding the record of it is
// not — and a bare 502 does exactly that.
//
// The hole is invisible from the outside, which is why it is worth a test
// rather than a comment. The student sees an error and finds no trace of the
// attempt in their history, and the cost of a run that burned tokens and
// produced nothing goes unrecorded — which is exactly the number a cost-per-
// caseload report (lib/counselor/economics.ts) or a bill reconciliation
// would need and not have.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("tier-fail");

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));

const { recordTierFailure } = await import("@/lib/evaluation/record-failure");
const { loadDashboard } = await import("@/lib/dashboard/load");
const { summariseHistoryRow } = await import("@/lib/evaluation/history");
const { buildProgress } = await import("@/lib/evaluation/progress");

/** Enough tokens that the cost is unmistakably non-zero. */
const usage = {
  inputTokens: 120_000,
  outputTokens: 8_000,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

describe.skipIf(!hasTestDb)("a tier run that failed after spending", () => {
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

  it("is recorded, with the tokens it burned", async () => {
    const id = await recordTierFailure({
      profileId,
      type: "DEEP_REVIEW",
      model: "claude-opus-5",
      promptVersion: "deep-review/v1",
      usage,
      error: "The review came back in a shape the app could not read.",
    });
    expect(id).toBeTruthy();

    const row = await prisma.evaluation.findUniqueOrThrow({
      where: { id: id! },
    });
    expect(row.status).toBe("failed");
    expect(row.inputTokens).toBe(120_000);
    expect(row.outputTokens).toBe(8_000);
    // The cost is stored, not merely derivable — this is the number someone
    // chasing a bill actually reads.
    expect(row.costCents).toBeGreaterThan(0);
    expect(row.error).toContain("could not read");
  });

  it("names the disallowed phrasing it was discarded for", async () => {
    // A student whose review vanished is owed the reason, and "odds of
    // admission" is a reason they can understand.
    const id = await recordTierFailure({
      profileId,
      type: "DEEP_REVIEW",
      model: "claude-opus-5",
      promptVersion: "deep-review/v1",
      usage,
      error:
        "The review was discarded for containing disallowed phrasing (percentage, probability). This app never states odds of admission.",
    });
    const row = await prisma.evaluation.findUniqueOrThrow({ where: { id: id! } });
    expect(row.error).toContain("percentage");
    expect(row.error).toContain("never states odds");
  });

  it("is never mistaken for an evaluation anywhere it would be read", async () => {
    await recordTierFailure({
      profileId,
      type: "DEEP_REVIEW",
      model: "claude-opus-5",
      promptVersion: "deep-review/v1",
      usage,
      error: "Discarded.",
    });

    // Not "where you stand" — it holds no assessment at all.
    const data = await loadDashboard();
    expect(data.latest).toBeNull();

    // Not a point on the trend chart.
    const rows = await prisma.evaluation.findMany({ where: { profileId } });
    expect(buildProgress(rows).points).toHaveLength(0);

    // But it IS visible in history, labelled as what it is — the retired
    // tier's name, since that is the prompt version that burned the tokens.
    const entry = summariseHistoryRow(rows[0]!);
    expect(entry.badge).toBe("Failed");
    expect(entry.tier).toBe("Deep Review (earlier format)");
  });

  it("does not throw when the row cannot be written", async () => {
    // Called on the error path. A failure to record a failure must not replace
    // the message the student was about to be given.
    const id = await recordTierFailure({
      profileId: "no-such-profile-id",
      type: "CHECK_IN",
      model: "claude-sonnet-5",
      promptVersion: "check-in/v1",
      usage,
      error: "Discarded.",
    });
    expect(id).toBeNull();
  });
});
