import Link from "next/link";
import { notFound } from "next/navigation";
import {
  findOwnedEvaluation,
  findPrecedingEvaluationModel,
} from "@/lib/ownership";
import { parseStoredResult } from "@/lib/validation/evaluation";
import { getRubricById } from "@/lib/rubrics";
import { findRequirementsForTargets } from "@/lib/requirements/lookup";
import { getOwnedPlannedItems } from "@/lib/ownership";
import { planDraftHref, plannedActionTitles } from "@/lib/plans/from-action";
import {
  REQUIREMENT_FIELDS,
  REQUIREMENT_LABELS,
} from "@/lib/validation/course-requirements";

function ScoreRing({
  score,
  label,
  emphasis = false,
}: {
  score: number;
  label: string;
  /** The number that actually matters for this student right now. */
  emphasis?: boolean;
}) {
  const tone =
    score >= 75
      ? "text-green-600 dark:text-green-400"
      : score >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";
  return (
    <div className="text-center">
      <div
        className={`font-semibold tabular-nums ${emphasis ? "text-5xl" : "text-3xl opacity-80"} ${tone}`}
      >
        {Math.round(score)}
        <span className={emphasis ? "text-lg text-zinc-400" : "text-base text-zinc-400"}>
          /100
        </span>
      </div>
      <div
        className={`mt-1 text-xs uppercase tracking-wide ${emphasis ? "font-medium text-zinc-600 dark:text-zinc-300" : "text-zinc-500"}`}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Should the stage-relative score be the headline?
 *
 * For a student years from applying, "vs applicants" is structurally low for
 * reasons that are not their fault, and making it the biggest number on the
 * page misrepresents where they stand. Read from the stage the model assigned,
 * falling back to the grade level in the stored snapshot.
 */
function shouldLeadWithStage(
  stageLabel: string | undefined,
  gradeLevel: string | undefined,
): boolean {
  const haystack = `${stageLabel ?? ""} ${gradeLevel ?? ""}`.toLowerCase();
  if (/final|grade 12|year 13|senior/.test(haystack)) return false;
  return /early|middle|grade 9|grade 10|grade 11|year 9|year 10|year 11|year 12/.test(
    haystack,
  );
}

const TRACK_STYLES: Record<string, string> = {
  ahead: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  on_track:
    "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  slightly_behind:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  behind: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
};

const TRACK_LABELS: Record<string, string> = {
  ahead: "ahead for your year",
  on_track: "on track for your year",
  slightly_behind: "slightly behind for your year",
  behind: "behind for your year",
};

const GAP_TIMING_STYLES: Record<string, string> = {
  now: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  soon: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  later: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
};

const GAP_TIMING_LABELS: Record<string, string> = {
  now: "act on this now",
  soon: "next year",
  later: "not yet — comes later",
};

const FOUNDATIONAL_LABELS: Record<string, string> = {
  high: "strong foundation",
  moderate: "useful foundation",
  low: "weak foundation",
  none: "nothing to build on",
};

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

/**
 * How selective the model judged each course to be.
 *
 * Shown next to the fit score because the two only mean something together:
 * 90/100 at an accessible school and 90/100 at an extremely selective one are
 * completely different facts about a student.
 */
const SELECTIVITY_LABELS: Record<string, string> = {
  open: "open admission",
  accessible: "accessible",
  selective: "selective",
  highly_selective: "highly selective",
  extremely_selective: "extremely selective",
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

  // Which model judged the run before this one. Follow-up evaluations run on a
  // cheaper model, anchored to the previous scores so they stay comparable —
  // but a student comparing two numbers is still owed the fact that a
  // different model produced them.
  const precedingModel =
    evaluation.isSample || !evaluation.model
      ? null
      : await findPrecedingEvaluationModel(evaluation);
  const judgeChanged =
    precedingModel !== null && precedingModel !== evaluation.model;

  const result = parseStoredResult(evaluation.resultJson);

  // Requirements shown from the DATABASE, not from the model's output. The
  // model is told to prefer these, but what a student reads as a sourced fact
  // must be the source itself — an echoed quote can drift, and an unattributed
  // requirement is the exact failure this data risks introducing.
  const snapshotTargets = (() => {
    try {
      const snap = evaluation.inputSnapshotJson
        ? (JSON.parse(evaluation.inputSnapshotJson) as {
            targets?: { name: string; country: string; course: string | null }[];
          })
        : null;
      return snap?.targets ?? [];
    } catch {
      return [];
    }
  })();
  const sourcedRequirements =
    snapshotTargets.length > 0
      ? await findRequirementsForTargets(snapshotTargets)
      : [];

  // Which recommended actions are already in this student's plan, so the page
  // shows what they have committed to rather than offering everything as new.
  // Ownership-scoped: getOwnedPlannedItems resolves the profile from the
  // session, never from anything in the URL.
  const plannedTitles = plannedActionTitles(
    result?.actions ?? [],
    (await getOwnedPlannedItems()).map((p) => p.title),
  );

  // The grade level as it was when this evaluation ran, for deciding which
  // score to lead with. Read from the frozen snapshot so an old evaluation
  // still renders the way it did at the time.
  let snapshotGradeLevel: string | undefined;
  try {
    const snapshot = evaluation.inputSnapshotJson
      ? (JSON.parse(evaluation.inputSnapshotJson) as {
          student?: { gradeLevel?: string | null };
        })
      : null;
    snapshotGradeLevel = snapshot?.student?.gradeLevel ?? undefined;
  } catch {
    // Unreadable snapshot: fall back to the stage label alone.
  }

  const leadWithStage =
    result?.gradeRelativeScore != null &&
    shouldLeadWithStage(result.stageOutlook?.stageLabel, snapshotGradeLevel);

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

      {judgeChanged && (
        <p className="rounded-lg border border-black/10 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
          <strong className="font-semibold text-foreground">
            Judged by a different model than the run before it.
          </strong>{" "}
          This one used {evaluation.model}; the previous used {precedingModel}.
          Your earlier scores were fed in as an anchor, so the numbers are meant
          to stay on the same scale — but if something moved and nothing in your
          profile changed, this is the first thing to suspect. Run a full
          evaluation from the evaluations page for a fresh read on the strongest
          model.
        </p>
      )}


      {evaluation.isSample && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>This is a sample, not an AI evaluation.</strong>{" "}
          No Anthropic API key is configured, so the app produced placeholder
          output to show the feature working end to end. Add{" "}
          <code>ANTHROPIC_API_KEY</code> to{" "}
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
                  emphasis={leadWithStage}
                />
              )}
              <ScoreRing
                score={result.overallScore}
                label="vs applicants"
                emphasis={!leadWithStage}
              />
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

            {/* What the numbers mean. Editorial framing, deliberately kept out
                of the model's output: it is barred from asserting admit rates,
                so the percentile -> selectivity translation lives here. */}
            <p className="mt-4 text-xs text-zinc-500">
              Both numbers are percentiles. {result.overallScore}/100 &ldquo;vs
              applicants&rdquo; means stronger than roughly{" "}
              {Math.round(result.overallScore)}% of people applying to targets
              like yours today
              {result.gradeRelativeScore != null && (
                <>
                  , while {Math.round(result.gradeRelativeScore)}/100 &ldquo;for
                  your year&rdquo; means stronger than roughly{" "}
                  {Math.round(result.gradeRelativeScore)}% of university-bound
                  students in your own year — a much broader group than the
                  applicants the first number compares you to
                </>
              )}
              . As a rough guide, the more selective a course is, the closer to
              the top of that range it draws from — but this app never estimates
              any university&apos;s actual admit rate, so check those yourself.
            </p>

            {leadWithStage && (
              <p className="mt-3 text-xs text-zinc-500">
                You have years left, so &ldquo;for your year&rdquo; is the
                number that means something right now. &ldquo;Vs
                applicants&rdquo; compares you to people submitting
                applications, most of whom are finishing school — expect it to
                be low, and expect it to move as you go.
              </p>
            )}
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

          {/* Where you are in school, and what that actually means. The
              rubrics describe a finished application; without this, a student
              years out is measured against a yardstick nothing they can
              currently do would satisfy. */}
          {result.stageOutlook && (
            <Card
              title="Where you are right now"
              subtitle="Judged against what's actually reachable at your stage — not against a finished application."
            >
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-medium">
                  {result.stageOutlook.stageLabel}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    TRACK_STYLES[result.stageOutlook.onTrack] ??
                    TRACK_STYLES.on_track
                  }`}
                >
                  {TRACK_LABELS[result.stageOutlook.onTrack] ??
                    result.stageOutlook.onTrack}
                </span>
              </div>

              <p className="mt-3 text-sm">
                <span className="font-medium">What matters now: </span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {result.stageOutlook.whatMattersNow}
                </span>
              </p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {result.stageOutlook.assessment}
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {result.stageOutlook.reachableNow.length > 0 && (
                  <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
                    <h4 className="text-sm font-medium">
                      Open to you now, not started
                    </h4>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      These are the real gaps at your stage.
                    </p>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {result.stageOutlook.reachableNow.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.stageOutlook.notYetExpected.length > 0 && (
                  <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
                    <h4 className="text-sm font-medium">
                      Not expected yet — don&apos;t worry about these
                    </h4>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Gated behind things you can&apos;t have yet. Their absence
                      is not counted against you.
                    </p>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {result.stageOutlook.notYetExpected.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}

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
            subtitle="Where you stand at each school specifically — your profile against that course's bar, not the readiness score repeated. A less selective school should score much higher than your headline number, and that's the point of having one on your list."
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
                      {/* Older rows carry a country name; newer ones don't ask
                          the model for one, since the rubric label says it. */}
                      {fit.country ? `${fit.country} · ` : ""}rubric:{" "}
                      {rubric ? rubric.name : fit.rubricUsed}
                      {fit.selectivity &&
                        ` · ${SELECTIVITY_LABELS[fit.selectivity] ?? fit.selectivity}`}
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
                        {/* The join between "you should do this" and the plan
                            that tracks whether you did. Without it the ranked
                            advice has to be retyped by hand, which nobody
                            does. */}
                        <div className="mt-3">
                          {plannedTitles.has(a.title) ? (
                            <Link
                              href="/plans"
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                            >
                              ✓ In your plan
                            </Link>
                          ) : (
                            <Link
                              href={planDraftHref(a)}
                              className="inline-flex items-center rounded-md border border-black/15 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                            >
                              Add to my plan
                            </Link>
                          )}
                        </div>
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
                          : `${item.helpfulness} help today`}
                      </span>
                      {/* An item can be worth little today and a great deal to
                          build on — that gap is the whole point in early years. */}
                      {item.foundationalValue && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            HELPFULNESS_STYLES[item.foundationalValue] ??
                            "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                          }`}
                        >
                          {FOUNDATIONAL_LABELS[item.foundationalValue] ??
                            item.foundationalValue}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {item.verdict}
                    </p>
                    {item.compoundsInto && (
                      <p className="mt-2 text-sm">
                        <span className="font-medium">
                          If you keep at it:{" "}
                        </span>
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {item.compoundsInto}
                        </span>
                      </p>
                    )}
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
            subtitle="What's missing given your stated targets — with when each one is actually worth acting on."
          >
            <ul className="space-y-3">
              {result.gaps.map((g, i) => (
                <li key={i}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{g.title}</p>
                    {g.timing && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          GAP_TIMING_STYLES[g.timing] ?? GAP_TIMING_STYLES.now
                        }`}
                      >
                        {GAP_TIMING_LABELS[g.timing] ?? g.timing}
                      </span>
                    )}
                  </div>
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

      {sourcedRequirements.length > 0 && (
        <Card
          title="Entry requirements on file"
          subtitle="Taken from official university and national admissions pages. Every line links to where it came from — check it yourself before relying on it."
        >
          <ul className="space-y-4">
            {sourcedRequirements.map((r) => (
              <li key={`${r.targetName}-${r.course}`}>
                <p className="font-medium">
                  {r.targetName} — {r.course}
                </p>
                <p className="text-xs text-zinc-400">
                  {r.stale || r.aging ? (
                    <span className="text-amber-700 dark:text-amber-400">
                      Not confirmed current —{" "}
                      {r.stale
                        ? `source was for the ${r.cycleYear} cycle`
                        : "requirements are republished annually"}
                      . Treat as a lead and verify.
                    </span>
                  ) : (
                    `For the ${r.cycleYear} cycle`
                  )}
                  {" · researched "}
                  {r.gatheredOn.toISOString().slice(0, 10)}
                  {" · "}
                  <a
                    href={r.primarySourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    source
                  </a>
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                  {REQUIREMENT_FIELDS.map((field) => {
                    const fact = r.requirements[field];
                    if (!fact) return null;
                    return (
                      <li key={field}>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {REQUIREMENT_LABELS[field]}:
                        </span>{" "}
                        {fact.value}{" "}
                        <a
                          href={fact.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zinc-400 underline underline-offset-2"
                        >
                          source
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
