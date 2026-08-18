// Which evaluation a projection measures from.
//
// The regression this guards against is entirely silent. A projection says
// "45 -> 58"; if the baseline comes back empty the model invents its own
// starting number and the sentence still reads correctly. Nothing throws,
// nothing looks broken, and the only students affected are the ones who
// adopted the newer tier — the ones most likely to trust the output.
import { describe, expect, it } from "vitest";
import {
  selectProjectionBaseline,
  type BaselineRow,
} from "@/lib/evaluation/projection-baseline";

const legacyResult = (overall: number) => ({
  overallScore: overall,
  gradeRelativeScore: 81,
  gradeContext: "Two different questions.",
  changeSinceLast: "First run.",
  headline: "Headline.",
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
      readinessScore: 54.6,
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
  actions: [],
  gaps: [],
  verifyThese: [],
});

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
  proposedCommitments: [
    { description: "Enter the olympiad", targetRung: null, dueInWeeks: 8 },
    { description: "Ship the project", targetRung: null, dueInWeeks: 12 },
  ],
};

const legacy = (id: string, at: string, score: number): BaselineRow => ({
  id,
  createdAt: new Date(at),
  overallScore: score,
  resultJson: JSON.stringify(legacyResult(score)),
  promptVersion: "evaluation/v10",
});

const deep = (id: string, at: string): BaselineRow => ({
  id,
  createdAt: new Date(at),
  overallScore: null,
  resultJson: JSON.stringify(deepReviewResult),
  promptVersion: "deep-review/v1",
});

describe("selectProjectionBaseline", () => {
  it("uses the most recent percentile evaluation", () => {
    const baseline = selectProjectionBaseline([
      legacy("newer", "2026-05-01", 58),
      legacy("older", "2026-01-01", 41),
    ]);
    expect(baseline.evaluationId).toBe("newer");
    expect(baseline.overallScore).toBe(58);
  });

  it("reaches PAST a newer deep review to the last percentile run", () => {
    // The whole point. Taking "whatever ran last" would return an empty
    // baseline here while the caller still treated it as one.
    const baseline = selectProjectionBaseline([
      deep("deep-1", "2026-06-01"),
      legacy("legacy-1", "2026-05-01", 58),
    ]);
    expect(baseline.evaluationId).toBe("legacy-1");
    expect(baseline.overallScore).toBe(58);
    expect(baseline.capturedAt).toBe(new Date("2026-05-01").toISOString());
  });

  it("carries per-system readiness, rounded, keyed by rubric", () => {
    const baseline = selectProjectionBaseline([legacy("a", "2026-05-01", 58)]);
    expect(baseline.systemReadiness).toEqual({ us_holistic: 55, uk_course: 71 });
  });

  it("returns an EMPTY baseline rather than a wrong one when there is none", () => {
    const baseline = selectProjectionBaseline([deep("deep-1", "2026-06-01")]);
    expect(baseline.evaluationId).toBeNull();
    expect(baseline.overallScore).toBeNull();
    expect(baseline.systemReadiness).toEqual({});
    // An absent baseline the prompt can see beats a fabricated one it can't.
    expect(baseline.capturedAt).toBeNull();
  });

  it("handles a student with no evaluations at all", () => {
    expect(selectProjectionBaseline([]).evaluationId).toBeNull();
  });

  it("never takes a band run's score column, even if one appears there", () => {
    const baseline = selectProjectionBaseline([
      { ...deep("deep-1", "2026-06-01"), overallScore: 91 },
      legacy("legacy-1", "2026-05-01", 58),
    ]);
    expect(baseline.overallScore).toBe(58);
  });

  it("dates the baseline to the run it came from, not to now", () => {
    // capturedAt is what tells a reader the baseline may be older than their
    // most recent evaluation, which after this change it often will be.
    const baseline = selectProjectionBaseline([
      deep("deep-1", "2026-06-01"),
      legacy("legacy-1", "2026-02-14", 44),
    ]);
    expect(baseline.capturedAt).toBe(new Date("2026-02-14").toISOString());
  });
});
