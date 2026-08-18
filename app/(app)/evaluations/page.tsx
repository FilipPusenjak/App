import Link from "next/link";
import { cacheVerdict, estimateCost, formatUsd } from "@/lib/cost";
import { getCurrentUser } from "@/lib/session";
import { getOwnedEvaluations, getProfileWithRelations } from "@/lib/ownership";
import {
  checkDeepReviewAllowed,
  tierForUser,
} from "@/lib/evaluation/tier-access";
import {
  buildProgress,
  schoolSeries,
  deltaFromPrevious,
} from "@/lib/evaluation/progress";
import { summariseHistoryRow } from "@/lib/evaluation/history";
import { isDeepReviewRow } from "@/lib/evaluation/tier-rows";
import { ScoreTrend } from "@/components/score-trend";
import { failStalePendingEvaluations } from "@/lib/evaluation/stale-sweep";
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
  // Recover anything abandoned by an interrupted run before listing, so a dead
  // evaluation is shown as failed-with-a-reason rather than "pending" forever.
  await failStalePendingEvaluations();

  const [user, profile, evaluations] = await Promise.all([
    getCurrentUser(),
    getProfileWithRelations(),
    getOwnedEvaluations(),
  ]);

  // Whether a Deep Review is available is resolved HERE, not discovered by
  // clicking. The route enforces both gates regardless — this is presentation,
  // not security — but a student who is inside the 21-day floor deserves to
  // read the reason on the page rather than receive it as a failed request,
  // and one whose plan does not include Deep Reviews should not be offered a
  // button whose only outcome is a 403.
  // isDeepReviewRow, not `type === "DEEP_REVIEW"`. The type column defaults to
  // DEEP_REVIEW, so matching on it counted a legacy evaluation as a Deep Review
  // and started the 21-day floor against a run that never happened — locking an
  // account out of its FIRST review for three weeks. The route decides this
  // with the same rule, from the same module.
  const lastDeepReview = evaluations.find(isDeepReviewRow);
  const deepReviewGate = user
    ? checkDeepReviewAllowed({
        tier: tierForUser(user),
        lastDeepReviewAt: lastDeepReview?.createdAt ?? null,
      })
    : ({ allowed: false, reason: "tier", message: "Not signed in." } as const);

  const progress = buildProgress(evaluations);
  const points = progress.points;
  const latest = points[points.length - 1] ?? null;
  const first = points[0] ?? null;
  const overallDelta =
    points.length > 1 ? deltaFromPrevious(progress, points.length - 1) : null;
  const totalChange =
    points.length > 1 && latest && first ? latest.overall - first.overall : null;

  // A real completed run exists, so the next ordinary one would be an anchored
  // follow-up on the cheaper model — which is when offering a full re-run
  // starts to mean something.
  const canFollowUp = evaluations.some(
    (e) => e.status === "completed" && !e.isSample,
  );

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
      <div className="flex flex-wrap items-start justify-between gap-4">
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
          canFollowUp={canFollowUp}
          deepReviewAllowed={deepReviewGate.allowed}
          deepReviewBlockedReason={
            deepReviewGate.allowed ? undefined : deepReviewGate.message
          }
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
              const entry = summariseHistoryRow(e);
              return (
                <li
                  key={e.id}
                  className="rounded-lg border border-black/10 p-4 dark:border-white/15"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* A percentile is toned by its value; a band never
                            is. "Emerging" is early, not bad, and a red pill
                            would tell a ninth-grader they are failing at
                            having started. */}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium first-letter:uppercase ${
                            entry.badgeIsScore
                              ? scoreTone(e.overallScore)
                              : scoreTone(null)
                          }`}
                        >
                          {entry.badge}
                        </span>
                        {/* The instrument, stated on every row. Two runs of
                            different tiers sitting next to each other are not
                            two readings of the same thing. */}
                        {!entry.badgeIsScore && entry.badge !== entry.tier && (
                          <span className="text-xs text-zinc-500">
                            {entry.tier}
                          </span>
                        )}
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
                      {entry.headline && (
                        <p className="mt-1.5 max-w-2xl text-sm leading-snug">
                          {entry.headline}
                        </p>
                      )}
                      {entry.detail && (
                        <p className="mt-1 text-xs text-zinc-500 first-letter:uppercase">
                          {entry.detail}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-zinc-500">
                        {e.createdAt.toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                        {e.model ? ` · ${e.model}` : ""}
                        {e.promptVersion ? ` · ${e.promptVersion}` : ""}
                      </p>
                      {/* What this run actually cost. Shown per run because
                          "it feels like it's getting more expensive" is not
                          something anyone can act on, and because a cache
                          write with no read is a LOSS that is otherwise
                          indistinguishable from a saving. */}
                      {(() => {
                        const cost = formatUsd(estimateCost(e, e.model));
                        if (!cost) return null;
                        const cache = cacheVerdict(e);
                        return (
                          <p className="mt-1 text-xs text-zinc-400">
                            {cost}
                            {e.inputTokens != null && e.outputTokens != null
                              ? ` · ${e.inputTokens.toLocaleString()} in / ${e.outputTokens.toLocaleString()} out`
                              : ""}
                            {cache.state === "hit"
                              ? ` · cache hit, saved ${formatUsd(cache.savedUsd)}`
                              : ""}
                            {cache.state === "write-only"
                              ? ` · cache written but not read (${formatUsd(cache.savedUsd)})`
                              : ""}
                          </p>
                        );
                      })()}
                      {e.status === "pending" && (
                        <p className="mt-1 text-xs text-zinc-500">
                          Started just now — an evaluation takes up to a
                          minute. Reload this page to see the result.
                        </p>
                      )}
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
