import Link from "next/link";
import { createPlanAction } from "@/app/actions/plan";
import { isEvaluationId } from "@/lib/plans/from-action";
import { PlanForm } from "../plan-form";

/**
 * Add a plan — optionally prefilled from an evaluation's recommended action.
 *
 * The prefill arrives as query parameters rather than an id lookup because it
 * is a DRAFT, not a reference: the student is free to reword it, retype it, or
 * abandon it, and nothing here should create a link back to an evaluation that
 * the plan then has to keep honest.
 *
 * Everything is clamped before it reaches the form. These values arrive in a
 * URL, so they are attacker-supplied by definition — someone can hand a student
 * any link they like. They are rendered as form values (React escapes them) and
 * re-validated server-side by plannedItemSchema on submit, so this is about
 * keeping a 50KB title out of the form rather than about injection.
 */
const clamp = (value: string | undefined, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    title?: string;
    description?: string;
    timeframe?: string;
    from?: string;
  }>;
}) {
  const params = await searchParams;
  const title = clamp(params.title, 200);
  const description = clamp(params.description, 2000);
  const timeframe = clamp(params.timeframe, 120);
  const fromAction = title.length > 0;

  // Validated here as well as in the action. Not redundant: this one decides
  // where a LINK points, the action's decides where a redirect goes, and a
  // back-link that disagreed with the save would be its own small bug.
  const returnTo = isEvaluationId(params.from) ? params.from! : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={returnTo ? `/evaluations/${returnTo}` : "/plans"}
        className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {returnTo ? "← Back to your evaluation" : "← Back to plans"}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {fromAction ? "Plan this action" : "Add a plan"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {fromAction
            ? "From your evaluation. Change anything you like — it's your plan, not the model's."
            : "Something you're considering doing but haven't done yet."}{" "}
          It won&apos;t count toward your scores until you mark it done.
        </p>
      </div>
      <PlanForm
        action={createPlanAction}
        submitLabel="Add plan"
        returnToEvaluationId={returnTo ?? undefined}
        values={
          fromAction
            ? {
                // The type is NOT guessed from the action's wording. The model
                // never states one, and inferring it would be a guess shown to
                // the student as though it came from the evaluation.
                type: "extracurricular",
                title,
                org: "",
                description,
                targetDate: "",
                hoursPerWeek: "",
              }
            : undefined
        }
        timeframeHint={timeframe || undefined}
      />
    </div>
  );
}
