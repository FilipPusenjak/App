import Link from "next/link";
import { notFound } from "next/navigation";
import { findOwnedProjection } from "@/lib/ownership";
import { parseStoredProjection } from "@/lib/validation/projection";
import { getRubricById } from "@/lib/rubrics";

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

const WORTH_STYLES: Record<string, string> = {
  high: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  moderate:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  low: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  negligible:
    "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

const WORTH_LABELS: Record<string, string> = {
  high: "worth doing",
  moderate: "some value",
  low: "little value",
  negligible: "not worth it",
};

/**
 * Current -> projected.
 *
 * The arrow is only drawn when the starting number was actually MEASURED by an
 * evaluation. When it wasn't, both ends would be the model's own estimate, and
 * an arrow between two guesses claims a movement nobody measured — which is
 * what made projections look inconsistent. In that case we show the projected
 * figure alone and say the baseline is missing.
 */
function Movement({
  current,
  projected,
  measured,
}: {
  current: number;
  projected: number;
  measured: boolean;
}) {
  if (!measured) {
    return (
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {Math.round(projected)}
            <span className="text-base text-zinc-400">/100</span>
          </span>
          <span className="text-sm text-zinc-500">projected</span>
        </div>
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          No measured starting point for this system — run an evaluation to get
          a real before-and-after.
        </p>
      </div>
    );
  }

  const delta = Math.round(projected) - Math.round(current);
  const tone =
    delta > 0
      ? "text-green-700 dark:text-green-400"
      : delta < 0
        ? "text-rose-700 dark:text-rose-400"
        : "text-zinc-500";
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-2xl font-semibold tabular-nums text-zinc-400">
        {Math.round(current)}
      </span>
      <span className="text-zinc-400">→</span>
      <span className="text-3xl font-semibold tabular-nums">
        {Math.round(projected)}
        <span className="text-base text-zinc-400">/100</span>
      </span>
      <span className={`text-sm font-medium ${tone}`}>
        {delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : "no change"}
      </span>
    </div>
  );
}

/**
 * Turn whatever the model put in wouldMoveNeedleFor into something a student
 * can read. It is asked for school names, but v1 returned rubric ids like
 * "us-holistic", and those went straight to the screen.
 */
function friendlyTargets(values: string[]): string {
  return values
    .map((v) => getRubricById(v)?.name ?? v)
    .join(", ");
}

export default async function ProjectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projection = await findOwnedProjection(id);
  if (!projection) notFound();

  const result = parseStoredProjection(projection.resultJson);

  // Which systems had a genuinely measured starting point. Read from the
  // stored input snapshot so an old projection still renders honestly.
  const measuredSystems = new Set<string>();
  try {
    const snapshot = projection.inputSnapshotJson
      ? (JSON.parse(projection.inputSnapshotJson) as {
          baseline?: { systemReadiness?: Record<string, number> };
        })
      : null;
    for (const key of Object.keys(snapshot?.baseline?.systemReadiness ?? {})) {
      measuredSystems.add(key);
    }
  } catch {
    // Unreadable snapshot: treat every baseline as unmeasured, which is the
    // conservative direction — we understate certainty rather than overstate it.
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/plans"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Back to plans
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Projection
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {projection.createdAt.toLocaleString("en-US", {
            dateStyle: "long",
            timeStyle: "short",
          })}
          {projection.model ? ` · ${projection.model}` : ""}
          {projection.promptVersion ? ` · ${projection.promptVersion}` : ""}
        </p>
      </div>

      {/* The load-bearing disclaimer. A projection is very easy to misread as
          an achievement, which is exactly what would make it harmful. */}
      <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        <strong>None of this has happened yet.</strong>{" "}
        Every number below is conditional on you actually doing the work, and
        doing it well. Planning something is worth nothing on an application —
        this is a map, not a result. Your real scores are unchanged.
      </p>

      {projection.isSample && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>This is a sample, not an AI projection.</strong>{" "}
          No Anthropic API key is configured, so the app produced placeholder
          output to show the feature working end to end.
        </p>
      )}

      {projection.status === "failed" && (
        <p className="rounded-lg border border-rose-300/60 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
          This projection failed: {projection.error ?? "unknown error"}
        </p>
      )}

      {!result ? (
        <p className="text-sm text-zinc-500">
          No result was stored for this projection.
        </p>
      ) : (
        <>
          <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
            <p className="font-medium">{result.headline}</p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {result.summary}
            </p>
            {result.changeSinceLastProjection && (
              <p className="mt-3 rounded-lg border border-black/10 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  Since your last projection:{" "}
                </span>
                {result.changeSinceLastProjection}
              </p>
            )}
          </section>

          {result.systemProjections.length > 0 && (
            <Card
              title="Where each system would land"
              subtitle="If you completed everything on your plan list. The two systems usually move by very different amounts — that difference is the useful part."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {result.systemProjections.map((sys, i) => {
                  const rubric = getRubricById(sys.rubricId);
                  return (
                    <div
                      key={`${sys.rubricId}-${i}`}
                      className="rounded-lg border border-black/10 p-4 dark:border-white/15"
                    >
                      <h3 className="text-sm font-medium">
                        {rubric?.name ?? sys.systemLabel}
                      </h3>
                      <div className="mt-2">
                        <Movement
                          current={sys.currentReadiness}
                          projected={sys.projectedReadiness}
                          measured={measuredSystems.has(sys.rubricId)}
                        />
                      </div>
                      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                        {sys.reasoning}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {result.planAssessments.length > 0 && (
            <Card
              title="Every plan, judged"
              subtitle="Including the ones that wouldn't move anything — knowing which is which is what saves you the wasted term."
            >
              <ul className="space-y-3">
                {result.planAssessments.map((plan, i) => (
                  <li
                    key={`${plan.planRef}-${i}`}
                    className="rounded-lg border border-black/10 p-4 dark:border-white/15"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{plan.planTitle}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          WORTH_STYLES[plan.worthDoing] ?? WORTH_STYLES.moderate
                        }`}
                      >
                        {WORTH_LABELS[plan.worthDoing] ?? plan.worthDoing}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {plan.verdict}
                    </p>
                    <p className="mt-2 text-sm">
                      <span className="font-medium">To make it count: </span>
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {plan.makeItCount}
                      </span>
                    </p>
                    {plan.wouldMoveNeedleFor.length > 0 && (
                      <p className="mt-2 text-xs text-zinc-400">
                        Helps: {friendlyTargets(plan.wouldMoveNeedleFor)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {result.sequencing.length > 0 && (
            <Card
              title="What order to do them in"
              subtitle="Most valuable first."
            >
              <ol className="space-y-3">
                {result.sequencing.map((step, i) => (
                  <li key={`${step.title}-${i}`} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">{step.title}</p>
                      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                        {step.detail}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">{step.when}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {result.cautions.length > 0 && (
            <Card
              title="Where this plan could go wrong"
              subtitle="Over-commitment is the usual one."
            >
              <ul className="list-inside list-disc space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                {result.cautions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </Card>
          )}

          {result.verifyThese.length > 0 && (
            <Card
              title="Verify these yourself"
              subtitle="The model does not have reliable current admissions data and is instructed never to invent it."
            >
              <ul className="list-inside list-disc space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                {result.verifyThese.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
