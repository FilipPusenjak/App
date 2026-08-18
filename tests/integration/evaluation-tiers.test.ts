// Tier guarantees that only a database can prove.
//
// Chiefly one: a stored evaluation is immutable and pinned to the rubric it was
// scored under. Recomputing history when the rubric changes would silently
// redraw a student's own past, and the timeline draws a boundary instead.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cleanupRun, createUserWithProfile, hasTestDb, makeRunTag } from "./helpers";

const runTag = makeRunTag("tiers");
const describeDb = hasTestDb ? describe : describe.skip;

let profileId = "";

async function makeEvaluation(over: Record<string, unknown> = {}) {
  return prisma.evaluation.create({
    data: {
      profileId,
      type: "DEEP_REVIEW",
      status: "completed",
      completedAt: new Date(),
      rubricVersion: "readiness/v1",
      sourceDataVersion: "requirements/2026-08-09",
      paceStatus: "ON_PACE",
      thresholdSnapshotJson: JSON.stringify({ band: "mostly met", schools: [] }),
      differentiationSnapshotJson: JSON.stringify({ band: "developing", rungs: {} }),
      resultJson: JSON.stringify({ sinceLastReview: "Baseline." }),
      inputTokens: 9000,
      outputTokens: 1200,
      costCents: 7,
      ...over,
    },
  });
}

describeDb("an evaluation is immutable and pinned", () => {
  beforeAll(async () => {
    const made = await createUserWithProfile(runTag, "immutable");
    profileId = made.profile.id;
  });

  afterAll(async () => {
    await cleanupRun(runTag);
  });

  it("keeps the rubric it was scored under when the rubric moves on", () => {
    // Nothing in the app recomputes stored evaluations. This is the assertion
    // that the property is real rather than merely intended: the row is written
    // under v1 and is still v1 after later rows arrive under v2.
    return (async () => {
      const old = await makeEvaluation({ rubricVersion: "readiness/v1" });
      await makeEvaluation({ rubricVersion: "readiness/v2" });

      const reread = await prisma.evaluation.findUniqueOrThrow({
        where: { id: old.id },
      });
      expect(reread.rubricVersion).toBe("readiness/v1");
      expect(reread.thresholdSnapshotJson).toBe(old.thresholdSnapshotJson);
      expect(reread.differentiationSnapshotJson).toBe(
        old.differentiationSnapshotJson,
      );
    })();
  });

  it("keeps the two snapshots separate, never a blended scalar", async () => {
    // A single combined readiness number is the thing this product must not
    // produce: it would let differentiation cover an unmet threshold.
    const e = await makeEvaluation();
    const row = await prisma.evaluation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.thresholdSnapshotJson).toBeTruthy();
    expect(row.differentiationSnapshotJson).toBeTruthy();
    expect(row.thresholdSnapshotJson).not.toBe(row.differentiationSnapshotJson);
  });

  it("records cost on every evaluation, for margin drift over four years", async () => {
    const e = await makeEvaluation();
    const row = await prisma.evaluation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.inputTokens).toBe(9000);
    expect(row.outputTokens).toBe(1200);
    expect(row.costCents).toBe(7);
  });

  it("records a no-change check-in at zero cost and no model", async () => {
    // The path that must not spend anything. It is still written down, so the
    // cadence stays visible in history.
    const e = await makeEvaluation({
      type: "CHECK_IN",
      materialChange: false,
      model: null,
      resultJson: null,
      inputTokens: null,
      outputTokens: null,
      costCents: 0,
    });
    const row = await prisma.evaluation.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.materialChange).toBe(false);
    expect(row.model).toBeNull();
    expect(row.costCents).toBe(0);
    expect(row.inputTokens).toBeNull();
  });

  it("chains to its preceding evaluation of the same type", async () => {
    const first = await makeEvaluation();
    const second = await makeEvaluation({ precedingEvaluationId: first.id });
    const row = await prisma.evaluation.findUniqueOrThrow({
      where: { id: second.id },
      include: { precedingEvaluation: true },
    });
    expect(row.precedingEvaluation?.id).toBe(first.id);
  });
});

describeDb("commitments", () => {
  const commitTag = makeRunTag("commit");
  let commitProfileId = "";

  beforeAll(async () => {
    const made = await createUserWithProfile(commitTag, "commitments");
    commitProfileId = made.profile.id;
  });

  afterAll(async () => {
    await cleanupRun(commitTag);
  });

  it("keeps abandoned ones, because dropping something is the signal", async () => {
    // A deep review reads the pattern of what a student abandons to propose
    // smaller commitments next time. Deleting them would erase exactly that.
    await prisma.commitment.create({
      data: {
        profileId: commitProfileId,
        description: "Run a weekly study group",
        status: "ABANDONED",
        resolvedAt: new Date(),
      },
    });
    const rows = await prisma.commitment.findMany({
      where: { profileId: commitProfileId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ABANDONED");
    expect(rows[0]!.resolvedAt).not.toBeNull();
  });

  it("starts life as PROPOSED, never accepted on the student's behalf", async () => {
    const c = await prisma.commitment.create({
      data: { profileId: commitProfileId, description: "Enter the olympiad" },
    });
    expect(c.status).toBe("PROPOSED");
  });
});

describeDb("profile digests", () => {
  const digestTag = makeRunTag("digest");
  let digestProfileId = "";

  beforeAll(async () => {
    const made = await createUserWithProfile(digestTag, "digest");
    digestProfileId = made.profile.id;
  });

  afterAll(async () => {
    await cleanupRun(digestTag);
  });

  it("holds one digest per completed grade year", async () => {
    for (const grade of [9, 10]) {
      await prisma.profileDigest.create({
        data: {
          profileId: digestProfileId,
          throughGrade: grade,
          summaryJson: JSON.stringify({ throughGrade: grade, activities: [] }),
        },
      });
    }
    const rows = await prisma.profileDigest.findMany({
      where: { profileId: digestProfileId },
    });
    expect(rows).toHaveLength(2);
  });

  it("refuses a second digest for the same year", async () => {
    // Two summaries of one year would make check-in context non-deterministic.
    await prisma.profileDigest.create({
      data: {
        profileId: digestProfileId,
        throughGrade: 11,
        summaryJson: "{}",
      },
    });
    await expect(
      prisma.profileDigest.create({
        data: {
          profileId: digestProfileId,
          throughGrade: 11,
          summaryJson: "{}",
        },
      }),
    ).rejects.toThrow();
  });
});
