// Sample evaluation — used ONLY when no ANTHROPIC_API_KEY is configured.
//
// This is NOT AI output. It exists so the whole pipeline (run -> validate ->
// store -> display -> history) can be exercised before an API key is available.
// Every row it produces is stored with isSample = true, and the UI labels it
// prominently. It deliberately does not fabricate anything specific about the
// student beyond echoing back what they entered, and it asserts no admissions
// facts whatsoever.
import { getRubric, rubricsForCountries } from "@/lib/rubrics";
import type { EvaluationSnapshot } from "./snapshot";
import type { EvaluationResult } from "@/lib/validation/evaluation";

export function buildSampleResult(
  snapshot: EvaluationSnapshot,
): EvaluationResult {
  const itemCount = snapshot.resumeItems.length;
  const targetCount = snapshot.targets.length;
  const predicted = snapshot.testScores.filter((t) => t.predicted).length;

  const schoolFits = snapshot.targets.map((t) => {
    const rubric = getRubric(t.country);
    const isUk = rubric.id === "uk-course-specific";
    return {
      schoolName: t.name,
      country: t.countryName,
      course: t.course ?? "Not specified",
      rubricUsed: rubric.id,
      fitScore: 50,
      classification: "match" as const,
      classificationReason:
        "SAMPLE OUTPUT — a real evaluation classifies each target as reach, match, or safety from your actual profile.",
      assessment: isUk
        ? `SAMPLE OUTPUT — not a real assessment. A real evaluation would judge this target under the ${rubric.name} rubric, which weighs depth in ${t.course ?? "the specific course"} and predicted grades far above unrelated activities.`
        : `SAMPLE OUTPUT — not a real assessment. A real evaluation would judge this target under the ${rubric.name} rubric, which weighs the whole profile: academic rigor in context, a distinctive strength, and how coherently the pieces fit together.`,
      keyRisks: [
        "This is placeholder text, not an evaluation of your profile.",
      ],
    };
  });

  // One entry per distinct admissions system in the targets, mirroring what a
  // real evaluation produces — so the per-system UI is exercised too.
  const systemScores = rubricsForCountries(
    snapshot.targets.map((t) => t.country),
  ).map((rubric) => ({
    rubricId: rubric.id,
    systemLabel: rubric.name,
    readinessScore: 50,
    gradeRelativeScore: 50,
    assessment:
      "SAMPLE OUTPUT — a real evaluation scores each admissions system separately, because a broad profile can be strong for US holistic review while counting for much less on a UK course application.",
  }));

  return {
    overallScore: 50,
    gradeRelativeScore: 50,
    systemScores,
    changeSinceLast:
      "SAMPLE OUTPUT — a real evaluation compares against your previous one and explains exactly what moved and why.",
    gradeContext:
      "SAMPLE OUTPUT — a real evaluation gives you two percentiles: where you place among people applying to targets like yours, and where you place among students in your own year. Those are usually very different numbers, especially in earlier years.",
    stageOutlook: {
      stageLabel: "SAMPLE — stage not assessed",
      whatMattersNow:
        "SAMPLE OUTPUT — a real evaluation works out which stage you're at and says what actually matters at it, instead of judging you against a finished application.",
      onTrack: "on_track" as const,
      assessment:
        "SAMPLE OUTPUT — no assessment of your foundations was made. A real evaluation separates what you can't do yet from what you could be doing and aren't.",
      reachableNow: [
        "SAMPLE OUTPUT — a real evaluation lists the things genuinely open to you right now that you haven't started.",
      ],
      notYetExpected: [
        "SAMPLE OUTPUT — a real evaluation names the things that are gated at your stage, so you don't worry about them.",
      ],
    },
    headline:
      "SAMPLE EVALUATION — this is placeholder output, not an AI assessment of your profile.",
    summary:
      `No Anthropic API key is configured, so the app generated this sample instead of calling the model. ` +
      `It confirms the evaluation pipeline works end to end: your profile was read (${itemCount} resume item${itemCount === 1 ? "" : "s"}, ` +
      `${snapshot.testScores.length} test score${snapshot.testScores.length === 1 ? "" : "s"}${predicted > 0 ? `, ${predicted} predicted` : ""}, ` +
      `${targetCount} target${targetCount === 1 ? "" : "s"}), the correct country rubric was selected per target, and the result was validated and saved. ` +
      `Add ANTHROPIC_API_KEY to .env.local and run again to get a real, calibrated evaluation.`,
    strengths: [
      {
        title: "Pipeline verified (sample)",
        detail:
          "Your profile data was read and matched to the right admissions rubric per target school. No real assessment was performed.",
        relevantTo: ["all"],
      },
    ],
    weaknesses: [
      {
        title: "No real evaluation was performed",
        detail:
          "This output is placeholder text. It contains no judgement about your profile. Configure an API key to get an honest, calibrated assessment.",
        severity: "significant",
      },
    ],
    narrativeCoherence: {
      score: 50,
      assessment:
        "SAMPLE OUTPUT — narrative coherence was not assessed. A real evaluation examines whether your coursework, activities, and stated goals tell one credible story.",
    },
    schoolFits,
    itemAssessments: snapshot.resumeItems.map((item) => ({
      itemRef: item.ref,
      itemTitle: item.title,
      helpfulness: "moderate" as const,
      foundationalValue: "moderate" as const,
      compoundsInto:
        "SAMPLE OUTPUT — a real evaluation says what this could become if you keep at it, which matters more than its value today when you have years left.",
      verdict:
        "SAMPLE OUTPUT — this item was not assessed. A real evaluation judges how much it actually helps, and says so plainly when the answer is 'not much'.",
      howToStrengthen:
        "Configure an API key to get a concrete, specific suggestion for this item.",
      bestFor: ["all"],
    })),
    actions: [
      {
        title: "Add your Anthropic API key",
        detail:
          "Put ANTHROPIC_API_KEY in .env.local and restart the dev server. Until then this app produces samples instead of real evaluations.",
        effort: "low" as const,
        impact: "high" as const,
        timeframe: "now",
        appliesTo: ["all"],
      },
      {
        title: "Re-run the evaluation",
        detail:
          "With a key configured, run the evaluation again to get a prioritized action list based on your actual profile and targets.",
        effort: "low" as const,
        impact: "high" as const,
        timeframe: "now",
        appliesTo: ["all"],
      },
    ],
    gaps: [
      {
        title: "Real evaluation not yet run",
        detail:
          "Add ANTHROPIC_API_KEY to .env.local, restart the dev server, and run the evaluation again.",
        timing: "now" as const,
        appliesTo: ["all"],
      },
    ],
    verifyThese: [
      "Everything above is placeholder text and should not be relied on.",
      "Admissions requirements, entry grades, and test requirements always need verifying on each university's official course page for your year of entry.",
    ],
  };
}
