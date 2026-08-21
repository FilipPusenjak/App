import type { SessionPrepNarrative } from "@/lib/validation/counselor";
import { OptionDecision, type RecommendationRow } from "./option-decision";

/**
 * A session prep, rendered for the four minutes before the student arrives.
 *
 * The ordering is deliberate and is not the schema's order. A counselor reads
 * this under time pressure, so it leads with what changed and what to raise,
 * and puts the questions high — those are the part they physically need in the
 * room, where the options are something they will have already decided about.
 *
 * `whatIMayHaveMissed` sits at the end and is visually distinct: it is the
 * field that justifies the subscription, and burying it in the middle of a list
 * would waste the one thing here a professional could not have worked out.
 */
export function PrepBody({
  prepId,
  generatedAt,
  outcome,
  counselorNotes,
  narrative,
  recommendations,
}: {
  prepId: string;
  generatedAt: Date;
  outcome: string;
  counselorNotes: string | null;
  narrative: SessionPrepNarrative;
  recommendations: RecommendationRow[];
}) {
  // Matched on text rather than position. The rows were written by a createMany
  // that shares one timestamp, so their read-back order is not guaranteed to be
  // the narrative's order, and attaching the wrong decision to an option would
  // silently corrupt the one column in this product worth having.
  const byText = new Map(recommendations.map((r) => [r.text, r]));

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-500">Session prep</h2>
          <span className="text-xs text-zinc-500">
            {generatedAt.toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {outcome !== "PENDING" && ` · ${outcome.toLowerCase()}`}
          </span>
        </div>
        <p className="mt-2 text-lg font-medium leading-snug">
          {narrative.headline}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {narrative.sinceLastSession}
        </p>
        {/* Said plainly, because a counselor should not have to infer it: this
            is drafting material, and they decide what any of it becomes. */}
        <p className="mt-4 border-t border-black/10 pt-3 text-xs text-zinc-500 dark:border-white/10">
          Drafted from computed signals for you to work from — not a report for
          the student, and not a recommendation. Every point below names the
          fact behind it so you can check it before you use it.
        </p>
      </section>

      {narrative.discussionPoints.length > 0 && (
        <Card title="Worth raising" subtitle="Each with the computed fact behind it.">
          <ul className="space-y-3">
            {narrative.discussionPoints.map((p, i) => (
              <li key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <UrgencyPill urgency={p.urgency} />
                  <span className="text-sm font-medium">{p.point}</span>
                </div>
                <BasisLine basis={p.basis} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {narrative.questionsToAsk.length > 0 && (
        <Card
          title="Only you can find these out"
          subtitle="Things the profile cannot contain. This is the part to take into the room."
        >
          <ul className="space-y-2">
            {narrative.questionsToAsk.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-zinc-400">—</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {narrative.optionsToConsider.length > 0 && (
        <Card
          title="Options"
          subtitle="With what each costs. You choose — this deliberately does not."
        >
          <ul className="space-y-3">
            {narrative.optionsToConsider.map((o, i) => (
              <li
                key={i}
                className="rounded-lg border border-black/10 p-3 dark:border-white/15"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <FeasibilityPill feasibility={o.feasibility} />
                  <span className="text-sm font-medium">{o.option}</span>
                </div>
                {/* The tradeoff is not decoration. An option without one is a
                    recommendation wearing a disguise, and the counselor has
                    information about cost that this app never will. */}
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="text-zinc-400">Costs: </span>
                  {o.tradeoff}
                </p>
                <BasisLine basis={o.basis} />
                {/* Absent rather than disabled when the row is missing: a
                    control that cannot record anything is worse than none. */}
                {byText.has(o.option) && (
                  <OptionDecision recommendation={byText.get(o.option)!} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {narrative.whatIMayHaveMissed && (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">
            Slow or buried — what a session-to-session view would not catch
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {narrative.whatIMayHaveMissed}
          </p>
        </section>
      )}

      {counselorNotes && (
        <Card
          title="Your notes"
          subtitle="Read back into the next prep — this is the part the model cannot compute."
        >
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {counselorNotes}
          </p>
        </Card>
      )}
      <input type="hidden" value={prepId} readOnly />
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
    <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
      <h2 className="text-sm font-medium text-zinc-500">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * The traceable fact behind a claim, rendered rather than hidden.
 *
 * Shown as the raw signal name because that is what makes it checkable: a
 * counselor who sees `commitment.past_due_unresolved` can look at the signal
 * list above and confirm it, where a paraphrase would give them nothing to
 * confirm against.
 */
function BasisLine({ basis }: { basis: string }) {
  return (
    <p className="mt-1 font-mono text-xs text-zinc-400" title="The computed fact this came from">
      {basis}
    </p>
  );
}

function UrgencyPill({ urgency }: { urgency: string }) {
  const tone =
    urgency === "NOW"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
      : urgency === "THIS_TERM"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300";
  const label =
    urgency === "NOW" ? "now" : urgency === "THIS_TERM" ? "this term" : "monitor";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

function FeasibilityPill({ feasibility }: { feasibility: string }) {
  const tone =
    feasibility === "FEASIBLE"
      ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300"
      : feasibility === "TIGHT"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300";
  const label =
    feasibility === "FEASIBLE"
      ? "feasible"
      : feasibility === "TIGHT"
        ? "tight on time"
        : "too late";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}
