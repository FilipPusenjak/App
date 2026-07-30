import Link from "next/link";
import { notFound } from "next/navigation";
import { findOwnedEvaluation } from "@/lib/ownership";
import { parseStoredResult } from "@/lib/validation/evaluation";
import { getRubricById } from "@/lib/rubrics";

function ScoreRing({ score, label }: { score: number; label: string }) {
  const tone =
    score >= 75
      ? "text-green-600 dark:text-green-400"
      : score >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";
  return (
    <div className="text-center">
      <div className={`text-4xl font-semibold tabular-nums ${tone}`}>
        {Math.round(score)}
        <span className="text-lg text-zinc-400">/100</span>
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
    </div>
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
      {subtitle && <p className="mb-3 mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

const HELPFULNESS_STYLES: Record<string, string> = {
  high: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  moderate:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  low: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  negligible:
    "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

// Effort reads "cheaper is better"; impact reads "bigger is better".
const EFFORT_STYLES: Record<string, string> = {
  low: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  medium:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  high: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};
const IMPACT_STYLES: Record<string, string> = {
  low: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  medium:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  high: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
};

const CLASSIFICATION_STYLES: Record<string, string> = {
  reach: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  match: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  safety: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
};

const SEVERITY_STYLES: Record<string, string> = {
  minor: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  moderate:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  significant:
    "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

export default async function EvaluationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const evaluation = await findOwnedEvaluation(id);
  if (!evaluation) notFound();

  const result = parseStoredResult(evaluation.resultJson);

  return (
    <div className="space-y-6">
      <Link
        href="/evaluations"
        className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← Back to evaluations
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Evaluation</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {evaluation.createdAt.toLocaleString("en-US", {
            dateStyle: "long",
            timeStyle: "short",
          })}
          {evaluation.model ? ` · ${evaluation.model}` : ""}
          {evaluation.promptVersion ? ` · ${evaluation.promptVersion}` : ""}
        </p>
      </div>

      {evaluation.isSample && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>This is a sample, not an AI evaluation.</strong> No Anthropic
          API key is configured, so the app produced placeholder output to show
          the feature working end to end. Add <code>ANTHROPIC_API_KEY</code> to{" "}
          <code>.env.local</code>, restart the server, and run again for a real
          assessment.
        </div>
      )}

      {evaluation.status === "failed" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <strong>This evaluation failed.</strong> {evaluation.error}
        </div>
      )}

      {!result ? (
        <p className="text-sm text-zinc-500">
          No result was stored for this evaluation.
        </p>
      ) : (
        <>
          <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
            <div className="flex flex-wrap items-center gap-8">
              {result.gradeRelativeScore != null && (
                <ScoreRing
                  score={result.gradeRelativeScore}
                  label="For your year"
                />
              )}
              <ScoreRing score={result.overallScore} label="vs targets" />
              <ScoreRing
                score={result.narrativeCoherence.score}
                label="Narrative"
              />
              <div className="min-w-64 flex-1">
                <p className="font-medium">{result.headline}</p>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {result.summary}
                </p>
              </div>
            </div>
            {result.gradeContext && (
              <p className="mt-4 rounded-lg border border-black/10 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  Two scores, two questions:{" "}
                </span>
                {result.gradeContext}
              </p>
            )}
            {result.changeSinceLast && (
              <p className="mt-3 rounded-lg border border-black/10 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  Since your last evaluation:{" "}
                </span>
                {result.changeSinceLast}
              </p>
            )}
          </section>

          {/* Per-system scores. A single number across US and UK targets
              averages two systems that reward different things. */}
          {result.systemScores.length > 0 && (
            <Card
              title="By admissions system"
              subtitle="US holistic review and UK course-specific admissions reward different things, so they get their own scores. A gap between them is informative, not a contradiction."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {result.systemScores.map((sys, i) => (
                  <div
                    key={`${sys.rubricId}-${i}`}
                    className="rounded-lg border border-black/10 p-4 dark:border-white/15"
                  >
                    <h3 className="text-sm font-medium">{sys.systemLabel}</h3>
                    <div className="mt-3 flex flex-wrap items-center gap-6">
                      <ScoreRing
                        score={sys.readinessScore}
                        label="vs targets"
                      />
                      <ScoreRing
                        score={sys.gradeRelativeScore}
                        label="For your year"
                      />
                    </div>
                    <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                      {sys.assessment}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card
            title="Fit by target school"
            subtitle="Each school is judged by its own country's admissions rubric — not a single blended score."
          >
            <ul className="space-y-3">
              {result.schoolFits.map((fit, i) => {
                // Resolve by the recorded rubric id — fit.country is a display
                // name, not a code, so it can't be used for the lookup.
                const rubric = getRubricById(fit.rubricUsed);
                return (
                  <li
                    key={`${fit.schoolName}-${i}`}
                    className="rounded-lg border border-black/10 p-4 dark:border-white/15"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-medium">
                        {fit.schoolName}{" "}
                        <span className="font-normal text-zinc-500">
                          · {fit.course}
                        </span>
                      </h3>
                      <span className="flex shrink-0 items-center gap-2">
                        {fit.classification && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              CLASSIFICATION_STYLES[fit.classification] ?? ""
                            }`}
                          >
                            {fit.classification}
                          </span>
                        )}
                        <span className="text-sm font-semibold tabular-nums">
                          {Math.round(fit.fitScore)}/100
                        </span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {fit.country} · rubric:{" "}
                      {rubric ? rubric.name : fit.rubricUsed}
                    </p>
                    {fit.classificationReason && (
                      <p className="mt-2 text-sm italic text-zinc-500">
                        {fit.classificationReason}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {fit.assessment}
                    </p>
                    {fit.keyRisks.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                        {fit.keyRisks.map((r, j) => (
                          <li key={j}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Strengths">
              <ul className="space-y-3">
                {result.strengths.map((s, i) => (
                  <li key={i}>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {s.detail}
                    </p>
                    {s.relevantTo.length > 0 && (
                      <p className="mt-1 text-xs text-zinc-400">
                        Relevant to: {s.relevantTo.join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Weaknesses">
              <ul className="space-y-3">
                {result.weaknesses.map((w, i) => (
                  <li key={i}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{w.title}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          SEVERITY_STYLES[w.severity] ?? ""
                        }`}
                      >
                        {w.severity}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {w.detail}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {result.actions.length > 0 && (
            <Card
              title="Do these next"
              subtitle="Prioritized — most valuable first. Effort is what it costs you; impact is what it's worth."
            >
              <ol className="space-y-3">
                {result.actions.map((a, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-black/10 p-4 dark:border-white/15"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{a.title}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${EFFORT_STYLES[a.effort] ?? ""}`}
                          >
                            {a.effort} effort
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${IMPACT_STYLES[a.impact] ?? ""}`}
                          >
                            {a.impact} impact
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                          {a.detail}
                        </p>
                        <p className="mt-1 text-xs text-zinc-400">
                          {a.timeframe}
                          {a.appliesTo.length > 0
                            ? ` · ${a.appliesTo.join(", ")}`
                            : ""}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {result.itemAssessments.length > 0 && (
            <Card
              title="Every resume item, judged"
              subtitle="How much each item actually helps — and what would make it stronger. An item can matter for one country's targets and not another's."
            >
              <ul className="space-y-3">
                {result.itemAssessments.map((item, i) => (
                  <li
                    key={`${item.itemRef}-${i}`}
                    className="rounded-lg border border-black/10 p-4 dark:border-white/15"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{item.itemTitle}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${HELPFULNESS_STYLES[item.helpfulness] ?? ""}`}
                      >
                        {item.helpfulness === "negligible"
                          ? "negligible help"
                          : `${item.helpfulness} help`}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {item.verdict}
                    </p>
                    <p className="mt-2 text-sm">
                      <span className="font-medium">To strengthen: </span>
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {item.howToStrengthen}
                      </span>
                    </p>
                    {item.bestFor.length > 0 && (
                      <p className="mt-1 text-xs text-zinc-400">
                        Helps most: {item.bestFor.join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card
            title="Gaps"
            subtitle="What's missing given your stated targets."
          >
            <ul className="space-y-3">
              {result.gaps.map((g, i) => (
                <li key={i}>
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {g.detail}
                  </p>
                  {g.appliesTo.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-400">
                      Applies to: {g.appliesTo.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="Verify these yourself"
            subtitle="The model was told never to assert admissions requirements or statistics it isn't sure of. Anything uncertain lands here — check each on the university's official course page."
          >
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
              {result.verifyThese.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          </Card>

          <p className="text-xs text-zinc-400">
            AI-generated assessment. It can be wrong, and it does not decide
            admissions. Always confirm requirements with the universities
            themselves.
          </p>
        </>
      )}
    </div>
  );
}
