// A Deep Review, rendered.
//
// This is the replacement for the legacy evaluation's body, and the ordering
// answers a different question from the one the old page answered. A legacy
// evaluation opened with three numbers, because its claim was "here is where
// you rank". A Deep Review opens with what has changed since the last one,
// because its claim is "here is what your last months amounted to, and what to
// do with the next ones" — and a student who cannot tell movement from noise
// gets nothing from a level.
//
// Two rules run through the whole file:
//
//   MEASUREMENTS COME FROM THE SNAPSHOTS, judgements from the narrative. The
//   bands at the top were computed deterministically before the model ran.
//   Reading them back out of prose would put a paraphrase where a measurement
//   belongs, and the paraphrase is the part that can drift.
//
//   NOTHING IS CONVERTED INTO A NUMBER. There is no fit score here, and its
//   absence is the point: a 0-100 position against one school's bar was the
//   closest this app came to quoting odds.
import Link from "next/link";
import type { DeepReviewNarrative } from "@/lib/validation/tiers";
import { BAND_MEANINGS, PACE_LABELS } from "@/lib/dashboard/standing";
import { CommitmentControls } from "./commitment-controls";
import {
  Card,
  Pill,
  CLASSIFICATION_STYLES,
  DIRECTION_LABELS,
  DIRECTION_STYLES,
  FEASIBILITY_LABELS,
  FEASIBILITY_STYLES,
  FOUNDATIONAL_LABELS,
  HELPFULNESS_STYLES,
  SELECTIVITY_LABELS,
  dueLabel,
} from "./detail-ui";

export type DeepReviewCommitment = {
  id: string;
  description: string;
  status: string;
  dueDate: Date | null;
};

export function DeepReviewBody({
  narrative,
  bands,
  commitments,
}: {
  narrative: DeepReviewNarrative;
  /** Computed before the model ran — see the header comment. */
  bands: {
    requirements: string | null;
    differentiation: string | null;
    pace: string | null;
  };
  /** The commitments this review actually created, with their live status. */
  commitments: DeepReviewCommitment[];
}) {
  return (
    <>
      {/* ── Where this leaves you ─────────────────────────────────────── */}
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <p className="text-lg font-medium leading-snug">{narrative.headline}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <BandReading
            label="Requirements"
            value={bands.requirements}
            ceiling="Caps at met — a requirement cannot be more than satisfied."
          />
          <BandReading
            label="Differentiation"
            value={bands.differentiation}
            ceiling="No ceiling — there is no point at which the work is interesting enough."
          />
        </div>

        {bands.pace && (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            {PACE_LABELS[bands.pace] ?? bands.pace}
          </p>
        )}

        {/* Why there is no score here. Left in the interface rather than
            assumed, because a student arriving from an older evaluation will
            look for the number they used to get and deserves to be told why it
            is gone rather than left thinking something failed to load. */}
        <p className="mt-4 border-t border-black/10 pt-3 text-xs text-zinc-500 dark:border-white/10">
          These are bands, not scores. A Deep Review deliberately does not give
          a 0&ndash;100 position against any course: the closest thing to an
          honest number there would read as odds of admission, and nobody —
          including this app — can tell you those.
        </p>
      </section>

      <Card
        title="Since your last review"
        subtitle="Movement first. A read that starts from nowhere gives you no way to tell progress from noise."
      >
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {narrative.sinceLastReview}
        </p>
      </Card>

      {/* ── Trajectory ────────────────────────────────────────────────── */}
      <Card
        title="Trajectory"
        subtitle="The slope of your work, not its level — the level is in the bands above."
      >
        <Pill tone={DIRECTION_STYLES[narrative.trajectory.direction]}>
          {DIRECTION_LABELS[narrative.trajectory.direction] ??
            narrative.trajectory.direction}
        </Pill>
        <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {narrative.trajectory.assessment}
        </p>
      </Card>

      {/* ── Coherence ─────────────────────────────────────────────────── */}
      <Card
        title="Coherence"
        subtitle="Whether your activities read as one person with an interest, or as a list."
      >
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {narrative.coherence.assessment}
        </p>
        {narrative.coherence.incoherences.length > 0 && (
          <>
            {/* Named specifically, because "be more coherent" is not usable
                by anyone. */}
            <p className="mt-4 text-sm font-medium">
              What doesn&apos;t fit together yet
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
              {narrative.coherence.incoherences.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* ── Differentiation ───────────────────────────────────────────── */}
      <Card
        title="Differentiation"
        subtitle="What you have that most applicants to these courses will not."
      >
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {narrative.differentiation.assessment}
        </p>
        {narrative.differentiation.escalationOpportunities.length > 0 && (
          <>
            <p className="mt-4 text-sm font-medium">
              Where the next rung is
            </p>
            {/* Escalation, not addition: taking one existing thread further is
                worth more than starting another, and this list is the concrete
                form of that advice. */}
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
              {narrative.differentiation.escalationOpportunities.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* ── Commitments ───────────────────────────────────────────────── */}
      {commitments.length > 0 && (
        <Card
          title="What this review asked of you"
          subtitle="Proposed, never accepted on your behalf. A commitment only starts appearing in your check-ins once you take it on."
        >
          <ul className="space-y-3">
            {commitments.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-black/10 p-3 dark:border-white/15"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={COMMITMENT_STYLES[c.status]}>
                    {COMMITMENT_LABELS[c.status] ?? c.status}
                  </Pill>
                  {dueLabel(c.dueDate) && (
                    <span className="text-xs text-zinc-500">
                      {dueLabel(c.dueDate)}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm">{c.description}</p>
                <CommitmentControls id={c.id} status={c.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Per target ────────────────────────────────────────────────── */}
      {narrative.schoolFits.length > 0 && (
        <Card
          title="Against each target"
          subtitle="Judged by the admissions system of the country each course is in — a US holistic read and a UK course-specific one are different questions, and are not averaged."
        >
          <ul className="space-y-4">
            {narrative.schoolFits.map((fit, i) => (
              <li
                key={`${fit.schoolName}-${i}`}
                className="rounded-lg border border-black/10 p-4 dark:border-white/15"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {fit.schoolName}
                      {fit.course ? ` — ${fit.course}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {SELECTIVITY_LABELS[fit.selectivity] ?? fit.selectivity}
                      {fit.rubricUsed ? ` · ${fit.rubricUsed}` : ""}
                    </p>
                  </div>
                  <Pill tone={CLASSIFICATION_STYLES[fit.classification]}>
                    {fit.classification}
                  </Pill>
                </div>
                {/* The reason travels with the label. "Reach" on its own is a
                    verdict a student can do nothing with. */}
                <p className="mt-2 text-xs text-zinc-500">
                  {fit.classificationReason}
                </p>
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {fit.assessment}
                </p>
                {fit.keyRisks.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                    {fit.keyRisks.map((risk, r) => (
                      <li key={r}>{risk}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Item by item ──────────────────────────────────────────────── */}
      {narrative.itemAssessments.length > 0 && (
        <Card
          title="Your activities, one by one"
          subtitle="What each is worth, and what it could become if you kept going."
        >
          <ul className="space-y-4">
            {narrative.itemAssessments.map((item, i) => (
              <li
                key={`${item.itemRef}-${i}`}
                className="rounded-lg border border-black/10 p-4 dark:border-white/15"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{item.itemTitle}</p>
                  <Pill tone={HELPFULNESS_STYLES[item.helpfulness]}>
                    {item.helpfulness}
                  </Pill>
                  <Pill>
                    {FOUNDATIONAL_LABELS[item.foundationalValue] ??
                      item.foundationalValue}
                  </Pill>
                </div>
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {item.verdict}
                </p>
                {item.compoundsInto && (
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      If you keep going:
                    </span>{" "}
                    {item.compoundsInto}
                  </p>
                )}
                {item.howToStrengthen && (
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      To strengthen it:
                    </span>{" "}
                    {item.howToStrengthen}
                  </p>
                )}
                {item.bestFor.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-400">
                    Helps most for: {item.bestFor.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Gaps ──────────────────────────────────────────────────────── */}
      {narrative.gaps.length > 0 && (
        <Card
          title="Gaps"
          subtitle="Filtered by whether there is still time. Something already closed is still listed — you are owed that — but it is never dressed up as achievable."
        >
          <ul className="space-y-3">
            {narrative.gaps.map((gap, i) => (
              <li key={`${gap.title}-${i}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{gap.title}</p>
                  <Pill tone={FEASIBILITY_STYLES[gap.feasibility]}>
                    {FEASIBILITY_LABELS[gap.feasibility] ?? gap.feasibility}
                  </Pill>
                  {gap.monthsNeeded > 0 && (
                    <span className="text-xs text-zinc-500">
                      needs about {gap.monthsNeeded} month
                      {gap.monthsNeeded === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                  {gap.detail}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Verify ────────────────────────────────────────────────────── */}
      {narrative.verifyThese.length > 0 && (
        <Card
          title="Verify these yourself"
          subtitle="The model was told never to assert an admissions requirement or statistic it isn't sure of. Anything uncertain lands here — check each on the university's official course page."
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
            {narrative.verifyThese.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-xs text-zinc-400">
        AI-generated assessment. It can be wrong, and it does not decide
        admissions. Always confirm requirements with the universities
        themselves. Your{" "}
        <Link href="/dashboard" className="underline underline-offset-2">
          dashboard
        </Link>{" "}
        tracks what you took on from here.
      </p>
    </>
  );
}

/**
 * One band, with what it means.
 *
 * Rendered as a word and never as a bar, a fraction, or a position on a scale:
 * a band is an ordinal judgement, and drawing it as three-quarters of anything
 * would claim a precision the measurement does not have.
 */
function BandReading({
  label,
  value,
  ceiling,
}: {
  label: string;
  value: string | null;
  ceiling: string;
}) {
  return (
    <div>
      <p className="text-sm text-zinc-500">{label}</p>
      {/* first-letter, NOT `capitalize`: the bands are phrases, and CSS
          capitalize title-cases every word — "Gaps To Close" reads like a
          product name rather than a description of where someone is. */}
      <p className="mt-0.5 text-2xl font-semibold leading-tight first-letter:uppercase">
        {value ?? "—"}
      </p>
      {/* A bare "developing" is a word without a scale behind it, and a student
          reading it has no way to know whether it is good news. */}
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {value ? (BAND_MEANINGS[value] ?? ceiling) : "not measured for this run"}
      </p>
      <p className="mt-1 text-xs text-zinc-400">{ceiling}</p>
    </div>
  );
}

const COMMITMENT_STYLES: Record<string, string> = {
  PROPOSED: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  ACCEPTED:
    "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  IN_PROGRESS:
    "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  COMPLETED: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  ABANDONED: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
};

const COMMITMENT_LABELS: Record<string, string> = {
  PROPOSED: "proposed",
  ACCEPTED: "you took this on",
  IN_PROGRESS: "in progress",
  COMPLETED: "done",
  // Not "failed". Dropping something deliberately is a legitimate outcome, and
  // the app should not moralise about a student who changed direction.
  ABANDONED: "set aside",
};
