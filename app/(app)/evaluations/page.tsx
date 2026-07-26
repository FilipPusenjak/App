import Link from "next/link";
import { getOwnedEvaluations, getProfileWithRelations } from "@/lib/ownership";
import { RunEvaluationButton } from "./run-evaluation-button";

function scoreTone(score: number | null) {
  if (score == null) return "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300";
  if (score >= 75)
    return "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300";
  if (score >= 50)
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
  return "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300";
}

export default async function EvaluationsPage() {
  const [profile, evaluations] = await Promise.all([
    getProfileWithRelations(),
    getOwnedEvaluations(),
  ]);

  const noTargets = profile.targetSchools.length === 0;
  const noContent =
    profile.resumeItems.length === 0 && profile.testScores.length === 0;
  const disabledReason = noTargets
    ? "Add a target school first — the rubric depends on where you're applying."
    : noContent
      ? "Add resume items or test scores first — there's nothing to assess yet."
      : undefined;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Evaluations</h1>
          <p className="mt-1 text-sm text-zinc-500">
            An honest, calibrated assessment of your profile against your
            targets — US and UK rubrics applied separately.
          </p>
        </div>
        <RunEvaluationButton
          disabled={Boolean(disabledReason)}
          disabledReason={disabledReason}
        />
      </div>

      {evaluations.length > 0 ? (
        <ul className="space-y-3">
          {evaluations.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border border-black/10 p-4 dark:border-white/15"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${scoreTone(e.overallScore)}`}
                    >
                      {e.overallScore != null ? `${e.overallScore}/100` : e.status}
                    </span>
                    {e.isSample && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                        Sample — not AI output
                      </span>
                    )}
                    {e.status === "failed" && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                        Failed
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    {e.createdAt.toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {e.model ? ` · ${e.model}` : ""}
                  </p>
                  {e.error && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {e.error}
                    </p>
                  )}
                </div>
                {e.status === "completed" && (
                  <Link
                    href={`/evaluations/${e.id}`}
                    className="shrink-0 rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                  >
                    View
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-black/15 p-8 text-center dark:border-white/20">
          <p className="text-sm text-zinc-500">
            No evaluations yet.{" "}
            {disabledReason ?? "Click “Run evaluation” to get your first assessment."}
          </p>
        </div>
      )}
    </div>
  );
}
