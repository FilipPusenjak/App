import Link from "next/link";
import { getOwnedEvaluations, getProfileWithRelations } from "@/lib/ownership";
import {
  buildProgress,
  schoolSeries,
  deltaFromPrevious,
} from "@/lib/evaluation/progress";
import { ScoreTrend } from "@/components/score-trend";
import { RunEvaluationButton } from "./run-evaluation-button";

function scoreTone(score: number | null) {
  if (score == null)
    return "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300";
  if (score >= 75)
    return "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300";
  if (score >= 50)
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
  return "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300";
}

/** Signed change, coloured by direction. Neutral when flat. */
function Delta({ value }: { value: number }) {
  if (value === 0) {
    return <span className="text-xs text-zinc-400">no change</span>;
  }
  const up = value > 0;
  return (
    <span
      className={`text-xs font-medium ${
        up
          ? "text-green-700 dark:text-green-400"
          : "text-rose-700 dark:text-rose-400"
      }`}
    >
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {value} since previous
    </span>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function EvaluationsPage() {
  const [profile, evaluations] = await Promise.all([
    getProfileWithRelations(),
    getOwnedEvaluations(),
  ]);

  const progress = buildProgress(evaluations);
  const points = progress.points;
  const latest = points[points.length - 1] ?? null;
  const first = points[0] ?? null;
  const overallDelta =
    points.length > 1 ? deltaFromPrevious(progress, points.length - 1) : null;
  const totalChange =
    points.length > 1 && latest && first ? latest.overall - first.overall : null;

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

      {/* --- Progress over time --------------------------------------- */}
      {points.length >= 2 && latest && (
        <Card
          title="Progress over time"
          subtitle="Your overall score across evaluations. Sample runs are excluded — their score is a placeholder, not a measurement."
        >
          <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums">
              {latest.overall}
              <span className="text-base text-zinc-400">/100</span>
            </span>
            {overallDelta != null && <Delta value={overallDelta} />}
            {totalChange != null && totalChange !== overallDelta && (
              <span className="text-xs text-zinc-400">
                {totalChange >= 0 ? "+" : ""}
                {totalChange} since your first evaluation
              </span>
            )}
          </div>
          <ScoreTrend
            ariaLabel={`Overall profile score across ${points.length} evaluations, from ${first?.overall} to ${latest.overall} out of 100.`}
            points={points.map((p) => ({ label: p.label, value: p.overall }))}
          />
        </Card>
      )}

      {points.length === 1 && latest && (
        <Card
          title="Progress over time"
          subtitle="One evaluation so far — a trend needs at least two."
        >
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums">
              {latest.overall}
              <span className="text-base text-zinc-400">/100</span>
            </span>
            <span className="text-sm text-zinc-500">
              Improve your profile, then run another evaluation to see the
              change plotted here.
            </span>
          </div>
        </Card>
      )}

      {/* --- Per-school trajectories (small multiples) ------------------ */}
      {points.length >= 2 && progress.schools.length > 0 && (
        <Card
          title="Fit by school over time"
          subtitle="One panel per target. Because US and UK targets are judged by different rubrics, they can move in opposite directions — that's the point of showing them separately."
        >
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {progress.schools.map((school) => {
              const series = schoolSeries(progress, school);
              const values = series.filter((s) => s.value != null);
              const last = values[values.length - 1]?.value ?? null;
              const prev = values[values.length - 2]?.value ?? null;
              return (
                <div key={school}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="truncate text-sm font-medium" title={school}>
                      {school}
                    </h3>
                    <span className="shrink-0 text-sm tabular-nums text-zinc-500">
                      {last != null ? `${last}/100` : "—"}
                      {last != null && prev != null && last !== prev && (
                        <span
                          className={
                            last > prev
                              ? " text-green-700 dark:text-green-400"
                              : " text-rose-700 dark:text-rose-400"
                          }
                        >
                          {" "}
                          {last > prev ? "▲" : "▼"}
                          {Math.abs(last - prev)}
                        </span>
                      )}
                    </span>
                  </div>
                  <ScoreTrend
                    compact
                    ariaLabel={`Fit score for ${school} across evaluations.`}
                    points={series}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* --- History ---------------------------------------------------- */}
      <Card
        title="History"
        subtitle="Every evaluation is kept as a timestamped snapshot of the profile as it was at the time."
      >
        {evaluations.length > 0 ? (
          <ul className="space-y-3">
            {evaluations.map((e) => {
              // Index within the plotted (real) points, for the delta.
              const idx = progress.points.findIndex((p) => p.id === e.id);
              const delta =
                idx > 0 ? deltaFromPrevious(progress, idx) : null;
              return (
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
                          {e.overallScore != null
                            ? `${e.overallScore}/100`
                            : e.status}
                        </span>
                        {delta != null && <Delta value={delta} />}
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
                        {e.promptVersion ? ` · ${e.promptVersion}` : ""}
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
              );
            })}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-black/15 p-8 text-center dark:border-white/20">
            <p className="text-sm text-zinc-500">
              No evaluations yet.{" "}
              {disabledReason ??
                "Click “Run evaluation” to get your first assessment."}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
