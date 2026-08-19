// What the dashboard shows when a student's runs are a mix of shapes.
//
// This is the surface Stage 3 rewrote, and the failures worth catching are the
// quiet ones. A dashboard that renders blank where a band belongs still loads.
// One that shows a movement arrow between a percentile and a band still loads,
// and reports a change that never happened to the student. Neither throws, so
// neither would be noticed by anything except a test that names it.
//
// Real database, real ownership helpers: loadDashboard resolves the profile
// from the session and never from an argument, which is the guarantee that
// matters most on a screen holding data about a minor.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  cleanupRun,
  createUserWithProfile,
  hasTestDb,
  makeRunTag,
} from "./helpers";

const runTag = makeRunTag("dash-shapes");

const sessionUserId = { current: "" };
vi.mock("@/lib/session", () => ({
  requireUserId: async () => sessionUserId.current,
  getCurrentUser: async () => ({ id: sessionUserId.current }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadDashboard } = await import("@/lib/dashboard/load");

const legacyResult = (overall: number, headline: string) => ({
  overallScore: overall,
  gradeRelativeScore: 81,
  gradeContext: "Two different questions.",
  changeSinceLast: "First run.",
  headline,
  summary: "A summary.",
  stageOutlook: {
    stageLabel: "Grade 11",
    whatMattersNow: "Depth",
    onTrack: "on_track",
    assessment: "Fine",
    reachableNow: [],
    notYetExpected: [],
  },
  systemScores: [
    {
      rubricId: "us_holistic",
      systemLabel: "US",
      readinessScore: 55,
      gradeRelativeScore: 78,
      assessment: "ok",
    },
    {
      rubricId: "uk_course",
      systemLabel: "UK",
      readinessScore: 71,
      gradeRelativeScore: 84,
      assessment: "ok",
    },
  ],
  strengths: [],
  weaknesses: [],
  narrativeCoherence: { score: 70, assessment: "ok" },
  schoolFits: [],
  itemAssessments: [],
  actions: [
    {
      title: "Enter the olympiad",
      detail: "Registration closes in March.",
      effort: "medium",
      impact: "high",
      timeframe: "This term",
    },
    {
      title: "Ask for the reference",
      detail: "Before the summer.",
      effort: "low",
      impact: "medium",
      timeframe: "This month",
    },
  ],
  gaps: [],
  verifyThese: [],
});

const deepReviewResult = {
  headline: "Your physics thread is the one worth deepening.",
  sinceLastReview: "Baseline established.",
  trajectory: { assessment: "Steady climb.", direction: "STEADY" },
  coherence: { assessment: "Coherent.", incoherences: [] },
  differentiation: { assessment: "Developing.", escalationOpportunities: [] },
  schoolFits: [],
  itemAssessments: [],
  gaps: [],
  verifyThese: [],
  proposedCommitments: [
    { description: "Enter the olympiad", targetRung: null, dueInWeeks: 8 },
    { description: "Ship the project", targetRung: null, dueInWeeks: 12 },
  ],
};

const checkInResult = {
  headline: "One thing moved.",
  movement: { direction: "UP", driver: "Ran the workshop." },
  nextRung: null,
  actionThisFortnight: "Email the club lead.",
  commitmentPrompts: [],
};

async function seedLegacy(
  profileId: string,
  at: Date,
  overall: number,
  headline = "A legacy headline.",
) {
  return prisma.evaluation.create({
    data: {
      profileId,
      status: "completed",
      completedAt: at,
      createdAt: at,
      promptVersion: "evaluation/v10",
      overallScore: overall,
      resultJson: JSON.stringify(legacyResult(overall, headline)),
    },
  });
}

async function seedDeepReview(profileId: string, at: Date) {
  return prisma.evaluation.create({
    data: {
      profileId,
      type: "DEEP_REVIEW",
      status: "completed",
      completedAt: at,
      createdAt: at,
      promptVersion: "deep-review/v1",
      paceStatus: "ON_PACE",
      thresholdSnapshotJson: JSON.stringify({ band: "mostly met" }),
      differentiationSnapshotJson: JSON.stringify({ band: "developing" }),
      resultJson: JSON.stringify(deepReviewResult),
    },
  });
}

describe.skipIf(!hasTestDb)("the dashboard across evaluation shapes", () => {
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

  it("shows percentiles for a student whose latest run is legacy", async () => {
    await seedLegacy(profileId, new Date("2026-05-01"), 58, "Legacy headline.");

    const data = await loadDashboard();
    expect(data.latest?.headline).toBe("Legacy headline.");
    expect(data.latest?.standing.kind).toBe("percentile");
    expect(data.latest?.label).toBe("Evaluation");
  });

  it("shows bands for a student whose latest run is a deep review", async () => {
    await seedDeepReview(profileId, new Date("2026-06-01"));

    const data = await loadDashboard();
    const standing = data.latest?.standing;
    expect(standing?.kind).toBe("band");
    if (standing?.kind !== "band") throw new Error("unreachable");
    expect(standing.requirements).toBe("mostly met");
    expect(standing.differentiation).toBe("developing");
    expect(standing.pace).toBe("ON_PACE");
    expect(data.latest?.label).toBe("Deep Review");
    // The headline is the deep review's own, not a leftover from anything else.
    expect(data.latest?.headline).toContain("physics thread");
  });

  it("draws NO movement arrow across a shape boundary", async () => {
    // The regression that would be invisible: a legacy 58 followed by a deep
    // review, subtracted, would show a fall of 58 points the student never had.
    await seedLegacy(profileId, new Date("2026-05-01"), 58);
    await seedDeepReview(profileId, new Date("2026-06-01"));

    const data = await loadDashboard();
    expect(data.overallMove.kind).toBe("first");
    expect(data.gradeRelativeMove.kind).toBe("first");
  });

  it("draws no arrow across the boundary EVEN IF the band run has a score column", async () => {
    // The version of the bug that survives the obvious fix. Comparing the
    // overallScore columns instead of the shapes looks equivalent today only
    // because deep reviews leave that column null; the moment any tier writes
    // a number there, the dashboard would report a jump between two different
    // instruments as progress the student made.
    await seedLegacy(profileId, new Date("2026-05-01"), 58);
    const review = await seedDeepReview(profileId, new Date("2026-06-01"));
    await prisma.evaluation.update({
      where: { id: review.id },
      data: { overallScore: 91 },
    });

    const data = await loadDashboard();
    expect(data.overallMove.kind).toBe("first");
  });

  it("still compares two legacy runs to each other", async () => {
    // The guard above must not have been bought by disabling movement entirely.
    await seedLegacy(profileId, new Date("2026-04-01"), 41);
    await seedLegacy(profileId, new Date("2026-05-01"), 58);

    const data = await loadDashboard();
    expect(data.overallMove.kind).not.toBe("first");
  });

  it("offers open commitments as the next steps after a deep review", async () => {
    const review = await seedDeepReview(profileId, new Date("2026-06-01"));
    await prisma.commitment.createMany({
      data: [
        {
          profileId,
          sourceEvaluationId: review.id,
          description: "Enter the olympiad",
          status: "PROPOSED",
          dueDate: new Date("2026-08-01"),
        },
        {
          profileId,
          sourceEvaluationId: review.id,
          description: "Ship the co-op app",
          status: "ACCEPTED",
          dueDate: new Date("2026-09-01"),
        },
      ],
    });

    const data = await loadDashboard();
    const titles = data.latest?.nextSteps.map((s) => s.title) ?? [];
    expect(titles).toContain("Enter the olympiad");
    expect(titles).toContain("Ship the co-op app");
    // A proposed commitment is offered, never accepted on the student's behalf.
    const proposed = data.latest?.nextSteps.find(
      (s) => s.title === "Enter the olympiad",
    );
    expect(proposed?.status).toBe("PROPOSED");
    expect(proposed?.detail).toMatch(/accept it|decline/i);
  });

  it("does not offer a completed commitment as something to do next", async () => {
    const review = await seedDeepReview(profileId, new Date("2026-06-01"));
    await prisma.commitment.create({
      data: {
        profileId,
        sourceEvaluationId: review.id,
        description: "Already finished",
        status: "COMPLETED",
      },
    });

    const data = await loadDashboard();
    const titles = data.latest?.nextSteps.map((s) => s.title) ?? [];
    expect(titles).not.toContain("Already finished");
  });

  it("keeps legacy actions as the next steps for a legacy run", async () => {
    await seedLegacy(profileId, new Date("2026-05-01"), 58);

    const data = await loadDashboard();
    expect(data.latest?.nextSteps[0]?.title).toBe("Enter the olympiad");
    expect(data.latest?.nextSteps[0]?.meta).toContain("high impact");
  });

  it("ignores a no-change check-in when deciding where you stand", async () => {
    // It is a real, deliberate, free row — but it is not a standing, and
    // letting it become "latest" would blank the dashboard of a student whose
    // last real read was a week earlier.
    await seedDeepReview(profileId, new Date("2026-06-01"));
    await prisma.evaluation.create({
      data: {
        profileId,
        type: "CHECK_IN",
        status: "completed",
        completedAt: new Date("2026-06-15"),
        createdAt: new Date("2026-06-15"),
        materialChange: false,
        paceStatus: "ON_PACE",
      },
    });

    const data = await loadDashboard();
    expect(data.latest?.standing.kind).toBe("band");
    expect(data.latest?.headline).toContain("physics thread");
  });

  it("shows a check-in's one action when the check-in did find something", async () => {
    await prisma.evaluation.create({
      data: {
        profileId,
        type: "CHECK_IN",
        status: "completed",
        completedAt: new Date("2026-06-15"),
        createdAt: new Date("2026-06-15"),
        materialChange: true,
        promptVersion: "check-in/v1",
        paceStatus: "ON_PACE",
        resultJson: JSON.stringify(checkInResult),
      },
    });

    const data = await loadDashboard();
    // A fortnight's delta is not a standing, so there is no reading...
    expect(data.latest?.standing.kind).toBe("none");
    // ...but there is still exactly one thing to do.
    expect(data.latest?.nextSteps).toHaveLength(1);
    expect(data.latest?.nextSteps[0]?.title).toBe("Email the club lead.");
  });

  it("never reads another account's evaluations", async () => {
    const other = await createUserWithProfile(runTag, `other${Date.now()}`);
    await seedLegacy(other.profile.id, new Date("2026-05-01"), 99, "Not yours.");

    const data = await loadDashboard();
    expect(data.latest).toBeNull();
  });
});

// The scores do not stop existing when the instrument changes.
//
// A Deep Review measures in bands, so the moment one became the newest run the
// percentile block stopped rendering and the scores left the dashboard — taking
// the US/UK split with them, which is the one reading this app exists to keep
// separate. Nothing about those numbers had become untrue. They were simply no
// longer being looked for.
//
// The fix must not buy visibility with dishonesty, so these tests pin both
// halves: the scores come back, AND no band is ever turned into one.
describe.skipIf(!hasTestDb)("percentile scores survive a tier run", () => {
  let profileId = "";

  beforeEach(async () => {
    const { user, profile } = await createUserWithProfile(
      runTag,
      `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    sessionUserId.current = user.id;
    profileId = profile.id;
  });

  it("carries the last percentiles forward when a deep review is newest", async () => {
    // The reported symptom, stated as a test.
    await seedLegacy(profileId, new Date("2026-05-01"), 58);
    await seedDeepReview(profileId, new Date("2026-06-01"));

    const data = await loadDashboard();
    // The bands are still the current standing — this does not displace them.
    expect(data.latest?.standing.kind).toBe("band");
    // And the scores are on screen again.
    expect(data.carriedScores?.reading.readiness).toBe(58);
    expect(data.carriedScores?.reading.forYourYear).toBe(81);
  });

  it("keeps the US and UK scores separate on the way through", async () => {
    // The worst part of the disappearance. A student applying to both systems
    // lost the only place the two were shown apart, and a single blended number
    // is precisely the flattening this product refuses.
    await seedLegacy(profileId, new Date("2026-05-01"), 58);
    await seedDeepReview(profileId, new Date("2026-06-01"));

    const data = await loadDashboard();
    const perSystem = data.carriedScores?.reading.perSystem ?? [];
    expect(perSystem.map((s) => s.label).sort()).toEqual(["UK", "US"]);
    expect(perSystem.find((s) => s.label === "US")?.score).toBe(55);
    expect(perSystem.find((s) => s.label === "UK")?.score).toBe(71);
  });

  it("attributes them to the run that produced them, not to the review", async () => {
    // Undated, they read as a current measurement. The id and date are what
    // make the block honest rather than merely present.
    const legacy = await seedLegacy(profileId, new Date("2026-05-01"), 58);
    await seedDeepReview(profileId, new Date("2026-06-01"));

    const data = await loadDashboard();
    expect(data.carriedScores?.id).toBe(legacy.id);
    expect(data.carriedScores?.createdAt).toEqual(new Date("2026-05-01"));
  });

  it("carries them forward past a check-in too", async () => {
    // A check-in is a fortnight's delta and has no standing at all, so the
    // dashboard went blank of numbers entirely every other week.
    await seedLegacy(profileId, new Date("2026-05-01"), 58);
    await prisma.evaluation.create({
      data: {
        profileId,
        type: "CHECK_IN",
        status: "completed",
        completedAt: new Date("2026-06-15"),
        createdAt: new Date("2026-06-15"),
        materialChange: true,
        promptVersion: "check-in/v3",
        paceStatus: "ON_PACE",
        resultJson: JSON.stringify(checkInResult),
      },
    });

    const data = await loadDashboard();
    expect(data.latest?.standing.kind).toBe("none");
    expect(data.carriedScores?.reading.readiness).toBe(58);
  });

  it("does NOT carry anything when the newest run already has percentiles", async () => {
    // Otherwise the same two numbers appear twice on one card, once as current
    // and once as history — which reads as two different readings.
    await seedLegacy(profileId, new Date("2026-05-01"), 58);

    const data = await loadDashboard();
    expect(data.latest?.standing.kind).toBe("percentile");
    expect(data.carriedScores).toBeNull();
  });

  it("carries nothing for a student who has only ever run a deep review", async () => {
    // There is no score to show, and inventing one from the bands is the exact
    // conversion standing.ts exists to forbid.
    await seedDeepReview(profileId, new Date("2026-06-01"));

    const data = await loadDashboard();
    expect(data.carriedScores).toBeNull();
  });

  it("compares the two scored runs across an intervening deep review", async () => {
    // A Deep Review landing between two evaluations did not change either
    // score, so it must not break the comparison between them. Treating the
    // review as "the previous run" would report no movement where there was a
    // 17-point rise.
    await seedLegacy(profileId, new Date("2026-04-01"), 41);
    await seedLegacy(profileId, new Date("2026-05-01"), 58);
    await seedDeepReview(profileId, new Date("2026-06-01"));

    const data = await loadDashboard();
    const move = data.carriedScores?.overallMove;
    expect(move?.kind).toBe("moved");
    if (move?.kind === "moved") {
      expect(move.delta).toBe(17);
      expect(move.from).toBe(41);
    }
  });

  it("still refuses to compare a percentile to a band", async () => {
    // The guarantee the carry-forward must not have cost. The top-level
    // movement spans the shape boundary and stays "first"; only the carried
    // block, which compares like to like, reports a change.
    await seedLegacy(profileId, new Date("2026-05-01"), 58);
    await seedDeepReview(profileId, new Date("2026-06-01"));

    const data = await loadDashboard();
    expect(data.overallMove.kind).toBe("first");
    expect(data.gradeRelativeMove.kind).toBe("first");
  });

  it("never reads another account's scores into this dashboard", async () => {
    // The carry-forward reaches further back through history than anything
    // else on this screen, which makes it worth restating that it reaches back
    // through ONE student's history.
    const other = await createUserWithProfile(runTag, `cx${Date.now()}`);
    await seedLegacy(other.profile.id, new Date("2026-05-01"), 99, "Not yours.");
    await seedDeepReview(profileId, new Date("2026-06-01"));

    const data = await loadDashboard();
    expect(data.carriedScores).toBeNull();
  });
});

describe("do this next survives a check-in arriving", () => {
  let profileId = "";

  beforeEach(async () => {
    const { user, profile } = await createUserWithProfile(
      runTag,
      `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    );
    sessionUserId.current = user.id;
    profileId = profile.id;
  });

  async function seedReviewWithCommitments() {
    const review = await seedDeepReview(profileId, new Date("2026-06-01"));
    await prisma.commitment.createMany({
      data: [
        {
          profileId,
          sourceEvaluationId: review.id,
          description: "Enter the olympiad",
          status: "ACCEPTED",
          dueDate: new Date("2026-08-01"),
        },
        {
          profileId,
          sourceEvaluationId: review.id,
          description: "Speak to school about Further Maths",
          status: "PROPOSED",
        },
      ],
    });
    return review;
  }

  it("keeps the commitments when a check-in becomes the newest run", async () => {
    // The regression. buildNextSteps dispatched on the LATEST shape, so the
    // fortnightly tier — the one whose whole job is keeping follow-through
    // alive — silently emptied the list of things to follow through on.
    await seedReviewWithCommitments();
    await prisma.evaluation.create({
      data: {
        profileId,
        type: "CHECK_IN",
        status: "completed",
        completedAt: new Date("2026-06-15"),
        createdAt: new Date("2026-06-15"),
        materialChange: true,
        promptVersion: "check-in/v3",
        paceStatus: "ON_PACE",
        resultJson: JSON.stringify(checkInResult),
      },
    });

    const data = await loadDashboard();
    const titles = data.latest?.nextSteps.map((s) => s.title) ?? [];
    expect(titles).toContain("Enter the olympiad");
    expect(titles).toContain("Speak to school about Further Maths");
  });

  it("puts this fortnight's action first, ahead of standing commitments", async () => {
    await seedReviewWithCommitments();
    await prisma.evaluation.create({
      data: {
        profileId,
        type: "CHECK_IN",
        status: "completed",
        completedAt: new Date("2026-06-15"),
        createdAt: new Date("2026-06-15"),
        materialChange: true,
        promptVersion: "check-in/v3",
        paceStatus: "ON_PACE",
        resultJson: JSON.stringify(checkInResult),
      },
    });

    const data = await loadDashboard();
    // It has a deadline attached and was produced days ago; a commitment due in
    // six weeks does not outrank it.
    expect(data.latest?.nextSteps[0]?.title).toBe("Email the club lead.");
    expect(data.latest?.nextSteps[0]?.meta).toBe("this fortnight");
  });

  it("still shows commitments when a deep review is the newest run", async () => {
    await seedReviewWithCommitments();
    const data = await loadDashboard();
    const titles = data.latest?.nextSteps.map((s) => s.title) ?? [];
    expect(titles).toContain("Enter the olympiad");
  });

  it("does not resurrect a commitment that was completed or set aside", async () => {
    const review = await seedDeepReview(profileId, new Date("2026-06-01"));
    await prisma.commitment.createMany({
      data: [
        {
          profileId,
          sourceEvaluationId: review.id,
          description: "Already done",
          status: "COMPLETED",
        },
        {
          profileId,
          sourceEvaluationId: review.id,
          description: "Deliberately dropped",
          status: "ABANDONED",
        },
      ],
    });

    const data = await loadDashboard();
    const titles = data.latest?.nextSteps.map((s) => s.title) ?? [];
    expect(titles).not.toContain("Already done");
    expect(titles).not.toContain("Deliberately dropped");
  });

  it("keeps commitments out of a legacy-only student's list of actions", async () => {
    // A student who has never run a tier evaluation has no commitments, and the
    // legacy actions must still arrive in the model's ranked order.
    await seedLegacy(profileId, new Date("2026-05-01"), 58);
    const data = await loadDashboard();
    expect(data.latest?.nextSteps[0]?.title).toBe("Enter the olympiad");
    expect(data.latest?.nextSteps[0]?.commitmentId).toBeUndefined();
  });
});
