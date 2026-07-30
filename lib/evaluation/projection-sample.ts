// Sample projection — used ONLY when no ANTHROPIC_API_KEY is configured.
//
// Same purpose as the sample evaluation: exercise the whole pipeline before a
// key exists, while being impossible to mistake for real output.
import { rubricsForCountries } from "@/lib/rubrics";
import type { ProjectionSnapshot } from "./projection-snapshot";
import type { ProjectionResult } from "@/lib/validation/projection";

export function buildSampleProjection(
  snapshot: ProjectionSnapshot,
): ProjectionResult {
  const rubrics = rubricsForCountries(
    snapshot.profile.targets.map((t) => t.country),
  );
  const planCount = snapshot.plannedItems.length;

  return {
    headline:
      "SAMPLE PROJECTION — placeholder output, not an assessment of your plans.",
    summary:
      `No Anthropic API key is configured, so the app generated this sample instead of calling the model. ` +
      `It confirms the projection pipeline works: your profile and ${planCount} plan${planCount === 1 ? "" : "s"} were read, ` +
      `the correct rubric was selected per admissions system, and the result was validated and saved. ` +
      `Add ANTHROPIC_API_KEY to .env.local and run again for a real projection.`,
    systemProjections: rubrics.map((rubric) => ({
      rubricId: rubric.id,
      systemLabel: rubric.name,
      currentReadiness: snapshot.baseline.systemReadiness[rubric.id] ?? 50,
      projectedReadiness: snapshot.baseline.systemReadiness[rubric.id] ?? 50,
      reasoning:
        "SAMPLE OUTPUT — no projection was calculated. A real projection moves each system by a different amount, because the same plan can transform a UK course application and do almost nothing for a US one.",
    })),
    planAssessments: snapshot.plannedItems.map((plan) => ({
      planRef: plan.ref,
      planTitle: plan.title,
      worthDoing: "moderate" as const,
      verdict:
        "SAMPLE OUTPUT — this plan was not assessed. A real projection says plainly when a plan would not move anything.",
      wouldMoveNeedleFor: ["all"],
      makeItCount:
        "Configure an API key to get a concrete answer for this specific plan.",
    })),
    sequencing: [
      {
        title: "Add your Anthropic API key",
        detail:
          "Put ANTHROPIC_API_KEY in .env.local and restart the dev server, then run this projection again.",
        when: "now",
      },
    ],
    cautions: [
      "This is placeholder text and contains no judgement about your plans.",
      "Remember that a projection is conditional: nothing on a plan list has happened yet.",
    ],
    verifyThese: [
      "Everything above is placeholder text and should not be relied on.",
      "Course requirements and entry criteria always need checking on each university's official course page for your year of entry.",
    ],
  };
}
