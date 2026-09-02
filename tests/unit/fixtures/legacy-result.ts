// A valid legacy EvaluationResult, shared by the tests that need one.
//
// Extracted from mixed-shape-surfaces.test.ts when retention.test.ts needed
// the same thing: the stored shape is Zod-validated on read, so a minimal
// hand-written object silently reads as "unrecognised" and every assertion
// built on it passes for the wrong reason.
export const legacyResult = {
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
