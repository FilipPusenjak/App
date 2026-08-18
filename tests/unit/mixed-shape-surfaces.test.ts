// The surfaces that show evaluations of BOTH shapes side by side.
//
// Stage 3 pointed the dashboard, the trend chart, the history list and the
// projection baseline at a world where a student's runs are a mix of
// percentiles and bands. The failure worth testing for is not a crash — it is
// the quiet one: a band silently rendered as a number, a trend line drawn
// across the boundary between two instruments, or a projection that reports a
// baseline it does not actually have.
//
// Each test below asserts a guarantee that would be invisible if it broke.
import { describe, expect, it } from "vitest";
import { readStanding, BAND_MEANINGS, PACE_LABELS } from "@/lib/dashboard/standing";
import { readStoredEvaluation } from "@/lib/evaluation/stored-shape";
import { buildProgress } from "@/lib/evaluation/progress";
import { summariseHistoryRow } from "@/lib/evaluation/history";

const legacyResult = {
  overallScore: 58,
  gradeRelativeScore: 81,
  gradeContext: "Two different questions.",
  changeSinceLast: "First run.",
  headline: "A legacy evaluation headline.",
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
  schoolFits: [
    {
      schoolName: "Imperial",
      course: "Computing",
      rubricUsed: "uk_course",
      selectivity: "extremely_selective",
      classification: "reach",
      classificationReason: "Grades are short of the standard offer.",
      fitScore: 64,
      assessment: "A stretch on current predictions.",
    },
  ],
  itemAssessments: [],
  actions: [
    {
      title: "Enter the olympiad",
      detail: "Registration closes in March.",
      effort: "medium",
      impact: "high",
      timeframe: "This term",
    },
  ],
  gaps: [],
  verifyThese: [],
};

const deepReviewResult = {
  headline: "A deep review headline.",
  sinceLastReview: "Baseline established.",
  trajectory: { assessment: "Steady climb.", direction: "STEADY" },
  coherence: { assessment: "Coherent.", incoherences: [] },
  differentiation: { assessment: "Developing.", escalationOpportunities: [] },
  schoolFits: [],
  itemAssessments: [],
  gaps: [],
  verifyThese: [],
  // The schema requires at least two — a review that proposes one thing is a
  // to-do, not a strategy.
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

const legacyRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "legacy-1",
  status: "completed",
  isSample: false,
  overallScore: 58,
  resultJson: JSON.stringify(legacyResult),
  promptVersion: "evaluation/v10",
  type: null,
  createdAt: new Date("2026-03-01T00:00:00Z"),
  ...over,
});

const deepRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "deep-1",
  status: "completed",
  isSample: false,
  overallScore: null,
  resultJson: JSON.stringify(deepReviewResult),
  promptVersion: "deep-review/v1",
  type: "DEEP_REVIEW",
  thresholdSnapshotJson: JSON.stringify({ band: "mostly met" }),
  differentiationSnapshotJson: JSON.stringify({ band: "developing" }),
  paceStatus: "ON_PACE",
  createdAt: new Date("2026-04-01T00:00:00Z"),
  ...over,
});

const checkInRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "check-1",
  status: "completed",
  isSample: false,
  overallScore: null,
  resultJson: JSON.stringify(checkInResult),
  promptVersion: "check-in/v1",
  type: "CHECK_IN",
  thresholdSnapshotJson: JSON.stringify({ band: "mostly met" }),
  differentiationSnapshotJson: JSON.stringify({ band: "developing" }),
  paceStatus: "ON_PACE",
  materialChange: true,
  createdAt: new Date("2026-04-15T00:00:00Z"),
  ...over,
});

const snapshotsOf = (row: ReturnType<typeof deepRow>) => ({
  thresholdSnapshotJson: (row.thresholdSnapshotJson as string) ?? null,
  differentiationSnapshotJson: (row.differentiationSnapshotJson as string) ?? null,
  paceStatus: (row.paceStatus as string) ?? null,
});

describe("standing never converts between instruments", () => {
  it("reads a legacy run as percentiles", () => {
    const standing = readStanding(readStoredEvaluation(legacyRow()), {
      thresholdSnapshotJson: null,
      differentiationSnapshotJson: null,
      paceStatus: null,
    });
    expect(standing.kind).toBe("percentile");
    if (standing.kind !== "percentile") throw new Error("unreachable");
    expect(standing.readiness).toBe(58);
    expect(standing.forYourYear).toBe(81);
    expect(standing.perSystem).toHaveLength(2);
  });

  it("reads a deep review as bands, with no numbers anywhere in the reading", () => {
    const row = deepRow();
    const standing = readStanding(readStoredEvaluation(row), snapshotsOf(row));
    expect(standing.kind).toBe("band");
    if (standing.kind !== "band") throw new Error("unreachable");
    expect(standing.requirements).toBe("mostly met");
    expect(standing.differentiation).toBe("developing");
    // The whole point: no field on a band reading can be read as a score.
    for (const value of Object.values(standing)) {
      expect(typeof value).not.toBe("number");
    }
  });

  it("takes a deep review's bands from the computed snapshot, not from prose", () => {
    // The narrative says "Developing." — the snapshot says "distinctive". The
    // snapshot was computed deterministically before the model ran, so it wins.
    const row = deepRow({
      differentiationSnapshotJson: JSON.stringify({ band: "distinctive" }),
    });
    const standing = readStanding(readStoredEvaluation(row), snapshotsOf(row));
    if (standing.kind !== "band") throw new Error("unreachable");
    expect(standing.differentiation).toBe("distinctive");
  });

  it("refuses to present a check-in as a standing at all", () => {
    // A fortnight's delta is not "where you stand", and showing one as though
    // it were would present two weeks as the whole picture.
    const row = checkInRow();
    const standing = readStanding(readStoredEvaluation(row), snapshotsOf(row));
    expect(standing.kind).toBe("none");
  });

  it("has a plain-language meaning for every band either axis can produce", () => {
    // A bare "emerging" is a word without a scale behind it.
    for (const band of ["not checked", "gaps to close", "mostly met", "met"]) {
      expect(BAND_MEANINGS[band]).toBeTruthy();
    }
    for (const band of ["emerging", "developing", "competitive", "distinctive"]) {
      expect(BAND_MEANINGS[band]).toBeTruthy();
    }
    for (const status of ["AHEAD", "ON_PACE", "BEHIND"]) {
      expect(PACE_LABELS[status]).toBeTruthy();
    }
  });

  it("never calls a student behind as a character note", () => {
    expect(PACE_LABELS.BEHIND.toLowerCase()).not.toContain("lazy");
    expect(PACE_LABELS.BEHIND.toLowerCase()).not.toMatch(/you (are|'re) behind/);
  });
});

describe("the trend chart plots one instrument only", () => {
  it("plots legacy runs", () => {
    const progress = buildProgress([legacyRow(), legacyRow({ id: "legacy-2" })]);
    expect(progress.points).toHaveLength(2);
  });

  it("excludes deep reviews and check-ins", () => {
    const progress = buildProgress([legacyRow(), deepRow(), checkInRow()]);
    expect(progress.points.map((p) => p.id)).toEqual(["legacy-1"]);
  });

  it("excludes a band run EVEN IF it somehow carries a score column", () => {
    // The mutation that matters. Filtering on "overallScore != null" would pass
    // every other test in this file and fail here, drawing a line from a
    // percentile to a band — a change in the instrument shown as a change in
    // the student.
    const progress = buildProgress([
      legacyRow(),
      deepRow({ overallScore: 91 }),
    ]);
    expect(progress.points.map((p) => p.id)).toEqual(["legacy-1"]);
  });

  it("still excludes samples and failures", () => {
    const progress = buildProgress([
      legacyRow({ id: "s", isSample: true }),
      legacyRow({ id: "f", status: "failed" }),
      legacyRow(),
    ]);
    expect(progress.points.map((p) => p.id)).toEqual(["legacy-1"]);
  });
});

describe("history states which instrument produced each row", () => {
  it("shows a percentile for a legacy run, and marks it as a score", () => {
    const entry = summariseHistoryRow(legacyRow());
    expect(entry.badge).toBe("58/100");
    expect(entry.badgeIsScore).toBe(true);
    expect(entry.tier).toBe("Evaluation");
  });

  it("shows bands for a deep review, and never marks them as a score", () => {
    const entry = summariseHistoryRow(deepRow());
    expect(entry.badgeIsScore).toBe(false);
    expect(entry.badge).toContain("mostly met");
    expect(entry.detail).toContain("developing");
    expect(entry.tier).toBe("Deep Review");
  });

  it("never reduces a completed row to the bare word 'completed'", () => {
    // What the list did before it understood more than one shape.
    for (const row of [legacyRow(), deepRow(), checkInRow()]) {
      expect(summariseHistoryRow(row).badge.toLowerCase()).not.toBe("completed");
    }
  });

  it("says outright when a check-in found nothing, rather than looking empty", () => {
    const entry = summariseHistoryRow(
      checkInRow({ materialChange: false, resultJson: null }),
    );
    expect(entry.badge).toBe("No material change");
    expect(entry.tier).toBe("Check-In");
  });

  it("names the tier from the type column even when the narrative won't parse", () => {
    const entry = summariseHistoryRow(
      deepRow({ resultJson: "{ not json" }),
    );
    expect(entry.tier).toBe("Deep Review");
  });

  it("keeps pending and failed runs legible in every shape", () => {
    expect(summariseHistoryRow(deepRow({ status: "pending" })).badge).toBe("Running…");
    expect(summariseHistoryRow(deepRow({ status: "failed" })).badge).toBe("Failed");
  });
});

describe("the tier label never trusts the backfilled type column", () => {
  // Evaluation.type DEFAULTS to "DEEP_REVIEW". That default exists so pre-tier
  // rows are not mislabelled as check-ins — but it means every legacy
  // percentile evaluation ever written carries type = DEEP_REVIEW too.
  // Reading it first put a band-shaped name on a percentile-shaped run.
  it("calls a legacy row an Evaluation even though its type says DEEP_REVIEW", () => {
    const entry = summariseHistoryRow(
      legacyRow({ type: "DEEP_REVIEW", promptVersion: "evaluation/v10" }),
    );
    expect(entry.tier).toBe("Evaluation");
    // And still shows its percentile, so the row is internally consistent.
    expect(entry.badge).toBe("58/100");
    expect(entry.badgeIsScore).toBe(true);
  });

  it("calls a row with no promptVersion at all an Evaluation, by its shape", () => {
    // Written before promptVersion was recorded. The shape is the only honest
    // evidence, and the type column is the default rather than a decision.
    const entry = summariseHistoryRow(
      legacyRow({ type: "DEEP_REVIEW", promptVersion: null }),
    );
    expect(entry.tier).toBe("Evaluation");
  });

  it("still names a real deep review correctly", () => {
    // The fix must not have been bought by never saying "Deep Review".
    expect(summariseHistoryRow(deepRow()).tier).toBe("Deep Review");
  });

  it("names a FAILED deep review from its prompt version", () => {
    // The case the type column was originally reached for: the narrative does
    // not parse, so the shape is unknown. promptVersion still knows.
    const entry = summariseHistoryRow(
      deepRow({ status: "failed", resultJson: "{ not json", promptVersion: "deep-review/v3" }),
    );
    expect(entry.tier).toBe("Deep Review");
    expect(entry.badge).toBe("Failed");
  });

  it("names a no-change check-in, which has neither narrative nor promptVersion", () => {
    const entry = summariseHistoryRow(
      checkInRow({ materialChange: false, resultJson: null, promptVersion: null, type: "CHECK_IN" }),
    );
    expect(entry.tier).toBe("Check-In");
  });
});
