import Link from "next/link";
import {
  loadCaseloadAttention,
  describeBasis,
  type AttentionRow,
} from "@/lib/counselor/caseload";
import { loadFollowThroughPatterns } from "@/lib/counselor/recommendations";

/**
 * This week's attention list — the default screen.
 *
 * Not a student directory. A professional opening this on a Saturday morning is
 * deciding where to spend the day, and the two sentences that decide it are the
 * ordered list of who needs them and the count of who does not.
 */
export default async function CaseloadPage() {
  const [{ needsAttention, quietCount, totalActive }, patterns] =
    await Promise.all([loadCaseloadAttention(), loadFollowThroughPatterns()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">This week</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ordered by what needs your attention, not by how students are doing.
        </p>
      </div>

      {totalActive === 0 ? (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">No students yet</h2>
          <p className="mt-1 max-w-2xl text-zinc-600 dark:text-zinc-400">
            A student appears here once both they and a guardian have approved
            the link. Until then you can see nothing about them, which is
            deliberate.
          </p>
        </section>
      ) : (
        <>
          {/* The reassurance count, ABOVE the list rather than under it.
              "22 of 31 students have nothing requiring attention this week" is
              a load-bearing sentence for someone deciding how to spend a
              Saturday — it is the half of the answer that lets them stop
              worrying about the rest of the caseload. */}
          <section className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-white/5">
            <p className="text-sm">
              <strong className="font-semibold">
                {quietCount} of {totalActive}
              </strong>{" "}
              {quietCount === 1 ? "student has" : "students have"} nothing
              requiring attention this week.
              {needsAttention.length > 0 && (
                <>
                  {" "}
                  The {needsAttention.length}{" "}
                  {needsAttention.length === 1 ? "student" : "students"} below
                  {needsAttention.length === 1 ? " does" : " do"}.
                </>
              )}
            </p>
          </section>

          {needsAttention.length === 0 ? (
            <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
              <p className="text-zinc-600 dark:text-zinc-400">
                Nothing surfaced this week. Signals are recomputed nightly.
              </p>
            </section>
          ) : (
            <ul className="space-y-4">
              {needsAttention.map((row) => (
                <StudentCard key={row.linkId} row={row} />
              ))}
            </ul>
          )}

          {/* Below the list, never above it. This is retrospective and the list
              is the job; a pattern about last term's advice must not be the
              first thing a counselor reads on a Saturday morning. */}
          {patterns.length > 0 && (
            <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
              <h2 className="text-sm font-medium text-zinc-500">
                Noticed across your caseload
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                About the advice, not about you and not about the students.
                Nothing here is a score, and nothing here is compared to another
                counselor.
              </p>
              <ul className="mt-3 space-y-2">
                {patterns.map((p, i) => (
                  <li key={i} className="text-sm">
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {p.observation}
                    </span>{" "}
                    {/* The counts are shown so a counselor can discount the
                        observation themselves rather than take our word for
                        how much it means. */}
                    <span className="text-zinc-500">{p.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One student who needs attention, and why.
 *
 * Shows the SIGNALS, never a score. There is no readiness number, band or
 * percentile anywhere on this screen — a counselor allocating attention does
 * not need one, and a number here would invite exactly the comparison between
 * their own students that this product refuses to support.
 */
function StudentCard({ row }: { row: AttentionRow }) {
  return (
    <li className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{row.studentName}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {row.gradeLevel ?? "Grade not set"}
            {row.scope !== "FULL" && (
              <>
                {" · "}
                <span title="Your access to this student is limited">
                  {row.scope === "ACADEMIC_ONLY"
                    ? "academic records only"
                    : "activities only"}
                </span>
              </>
            )}
            {row.lastHeldAt && (
              <>
                {" · last met "}
                {row.lastHeldAt.toLocaleDateString("en-US", {
                  day: "numeric",
                  month: "short",
                })}
              </>
            )}
          </p>
        </div>
        <Link
          href={`/caseload/${row.linkId}`}
          className="shrink-0 rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Open
        </Link>
      </div>

      <ul className="mt-4 space-y-3">
        {row.signals.map((signal) => (
          <li key={signal.id}>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityDot severity={signal.severity} />
              <span className="text-sm font-medium">{signal.label}</span>
              <span className="text-xs text-zinc-500">
                since{" "}
                {signal.computedAt.toLocaleDateString("en-US", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </div>
            {/* The basis, INSPECTABLE rather than hidden.
                A counselor has to vet this before repeating it, and raw pairs
                are checkable against what they already know in a way that a
                sentence like "significantly overdue" is not. */}
            <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-5 text-xs text-zinc-500">
              {describeBasis(signal.basis).map((pair) => (
                <div key={pair.key} className="flex gap-1">
                  <dt className="text-zinc-400">{pair.key}:</dt>
                  <dd className="font-medium text-zinc-600 dark:text-zinc-400">
                    {pair.value}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Severity as a filled count, not a number or a colour alone.
 *
 * Deliberately unlabelled with words like "critical". This is a measure of how
 * soon a professional should look, and dressing it in alarm vocabulary would
 * make a 12th-grade prerequisite gap read as a judgement about the student
 * rather than about the calendar.
 */
function SeverityDot({ severity }: { severity: number }) {
  const tone =
    severity >= 5
      ? "bg-rose-500"
      : severity >= 4
        ? "bg-amber-500"
        : severity >= 3
          ? "bg-amber-400"
          : "bg-zinc-300 dark:bg-zinc-600";
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone}`}
      aria-label={`Severity ${severity} of 5`}
      title={`Severity ${severity} of 5 — how soon this needs looking at, not how the student is doing`}
    />
  );
}
