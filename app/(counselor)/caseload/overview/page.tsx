import Link from "next/link";
import {
  loadCaseloadOverview,
  type CaseloadOverview,
  type SignalKindCount,
  type WeekActivity,
} from "@/lib/counselor/overview";

/**
 * The practice overview.
 *
 * A dashboard, but of the WORK rather than of the children — see the header
 * comment in lib/counselor/overview.ts for why that distinction is the whole
 * design. Nothing on this screen names a student, orders students, or scores
 * anything, and the attention list remains the default screen because deciding
 * who to help is the job and this is only context for it.
 *
 * Every panel plots ONE series, so identity comes from the panel's title and no
 * categorical palette is needed — the bars reuse the single validated series
 * hue already defined for the score trend in globals.css.
 */
export default async function CaseloadOverviewPage() {
  const overview = await loadCaseloadOverview();

  if (overview.totalActive === 0) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">Nothing to show yet</h2>
          <p className="mt-1 max-w-2xl text-zinc-600 dark:text-zinc-400">
            This fills in once students appear on your caseload. A student
            appears when both they and a guardian have approved the link.
            {overview.pendingInvites > 0 && (
              <>
                {" "}
                You have{" "}
                <strong className="font-semibold">
                  {overview.pendingInvites}
                </strong>{" "}
                {overview.pendingInvites === 1 ? "invite" : "invites"} waiting on
                that approval.
              </>
            )}
          </p>
          <Link
            href="/caseload/students"
            className="mt-4 inline-block rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Invite a student
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading />
      <StatRow overview={overview} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SignalsByKind rows={overview.signalsByKind} total={overview.openSignals} />
        <SessionActivity
          weeks={overview.activity}
          heldInWindow={overview.heldInWindow}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CompositionPanel
          title="Year groups"
          caption="Who is on your caseload, by year. A count of people, not a measure of them."
          rows={overview.gradeComposition}
          total={overview.totalActive}
        />
        <CompositionPanel
          title="What you can see"
          caption="The access each family granted. A limited scope is a boundary they chose, not a gap to close."
          rows={overview.scopeComposition.map((s) => ({
            label: s.label,
            count: s.count,
          }))}
          total={overview.totalActive}
        />
      </div>

      {/* Said on the screen, not only in a comment. A professional wondering
          where the rankings are deserves to be told that the absence is the
          product rather than a feature still being built. */}
      <p className="max-w-3xl text-xs text-zinc-500">
        There is deliberately no ranking of your students here, and no caseload
        average. Everything above counts work — signals, sessions, year groups,
        consent scopes — because a number summarising how your students are
        doing would invite comparing children who are not comparable, and would
        not tell you anything about where to spend Saturday.
      </p>
    </div>
  );
}

function PageHeading() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-sm text-zinc-500">
        The shape of your caseload as work.{" "}
        <Link href="/caseload" className="underline underline-offset-2">
          This week
        </Link>{" "}
        is still where you decide who needs you.
      </p>
    </div>
  );
}

/* ── Headline numbers ─────────────────────────────────────────────────────
   Stat tiles rather than a chart: four unrelated single values have no shared
   scale to plot against, and a bare number is the most legible form there is
   for a figure someone reads once and acts on. */

function StatRow({ overview }: { overview: CaseloadOverview }) {
  const atLimit = overview.totalActive >= overview.caseloadLimit;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Need you this week"
        value={overview.needsAttention}
        detail={`of ${overview.totalActive} active`}
      />
      <Stat
        label="Nothing outstanding"
        value={overview.quiet}
        detail="no open signals"
      />
      <Stat
        label="Open signals"
        value={overview.openSignals}
        detail="across the caseload"
      />
      <Stat
        label="Plan"
        value={`${overview.totalActive}/${overview.caseloadLimit}`}
        detail={atLimit ? "at your limit" : "students used"}
        warn={atLimit}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  warn = false,
}: {
  label: string;
  value: number | string;
  detail: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-white/5">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          warn ? "text-amber-700 dark:text-amber-300" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">{detail}</p>
    </div>
  );
}

/* ── Signals by kind ──────────────────────────────────────────────────────
   A horizontal bar chart, because the labels are full sentences and a vertical
   axis would either truncate them or turn them sideways. One series, so one
   hue and no legend — the panel title says what the length means. */

function SignalsByKind({
  rows,
  total,
}: {
  rows: SignalKindCount[];
  total: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="score-trend rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
      <h2 className="text-sm font-medium text-zinc-500">What is surfacing</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        Your {total} open {total === 1 ? "signal" : "signals"} by kind — what the
        week is made of, not who it is about.
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Nothing open. Signals are recomputed nightly.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.kind}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  {row.label}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {row.count}
                </span>
              </div>
              {/* 4px rounded data-end, anchored to a baseline every bar shares,
                  so length is the only thing carrying the comparison. */}
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(row.count / max) * 100}%`,
                    background: "var(--series-1)",
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Session activity ─────────────────────────────────────────────────────
   Change over time, so a column per week. Two measures share one scale (both
   are counts of preps) and one is a subset of the other, so held is drawn
   inside generated rather than beside it — the gap IS the number worth seeing. */

function SessionActivity({
  weeks,
  heldInWindow,
}: {
  weeks: WeekActivity[];
  heldInWindow: number;
}) {
  const max = Math.max(1, ...weeks.map((w) => w.generated));
  const generatedInWindow = weeks.reduce((n, w) => n + w.generated, 0);

  return (
    <section className="score-trend rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
      <h2 className="text-sm font-medium text-zinc-500">Your sessions</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        Preps generated and sessions held, last {weeks.length}
        {" weeks. "}
        About your own week, not about anybody&rsquo;s progress.
      </p>

      {generatedInWindow === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          No preps generated in this window.
        </p>
      ) : (
        <>
          {/* Columns are h-full rather than items-end: a percentage height
              needs a parent with a definite one, and a shrink-to-fit flex item
              does not have that — the bars silently render at zero. */}
          <div className="mt-4 flex h-28 items-stretch gap-1.5">
            {weeks.map((week) => {
              const genPct = (week.generated / max) * 100;
              const heldPct = (week.held / max) * 100;
              return (
                <div
                  key={week.weekStart.toISOString()}
                  className="relative h-full flex-1"
                  title={`Week of ${week.weekStart.toLocaleDateString("en-US", {
                    day: "numeric",
                    month: "short",
                  })} — ${week.generated} generated, ${week.held} held`}
                >
                  <div
                    className="absolute bottom-0 w-full rounded-t-sm"
                    style={{
                      height: `${Math.max(genPct, week.generated > 0 ? 3 : 0)}%`,
                      background: "var(--series-1-fill)",
                    }}
                  />
                  {/* Held sits inside generated, flush to the same baseline. */}
                  <div
                    className="absolute bottom-0 w-full rounded-t-sm"
                    style={{
                      height: `${Math.max(heldPct, week.held > 0 ? 3 : 0)}%`,
                      background: "var(--series-1)",
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-zinc-500">
            <span>
              {weeks[0]?.weekStart.toLocaleDateString("en-US", {
                day: "numeric",
                month: "short",
              })}
            </span>
            <span>now</span>
          </div>

          {/* Two series, so a legend is present rather than relying on the
              shade alone to say which is which. */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-black/10 pt-3 text-xs dark:border-white/10">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: "var(--series-1)" }}
              />
              <span className="text-zinc-600 dark:text-zinc-400">
                Held · <span className="tabular-nums">{heldInWindow}</span>
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: "var(--series-1-fill)" }}
              />
              <span className="text-zinc-600 dark:text-zinc-400">
                Generated · <span className="tabular-nums">{generatedInWindow}</span>
              </span>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/* ── Composition ──────────────────────────────────────────────────────────
   Part-to-whole across a handful of named groups. Rows with a proportion bar
   rather than a pie: the labels are long, the counts are small, and a reader
   comparing two slices of a pie is guessing. */

function CompositionPanel({
  title,
  caption,
  rows,
  total,
}: {
  title: string;
  caption: string;
  rows: { label: string; count: number }[];
  total: number;
}) {
  return (
    <section className="score-trend rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
      <h2 className="text-sm font-medium text-zinc-500">{title}</h2>
      <p className="mt-0.5 text-xs text-zinc-500">{caption}</p>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {row.label}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {row.count}
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(row.count / Math.max(1, total)) * 100}%`,
                  background: "var(--series-1)",
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
