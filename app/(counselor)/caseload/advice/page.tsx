import Link from "next/link";
import {
  loadAdviceLog,
  loadFollowThroughPatterns,
  type AdviceRow,
} from "@/lib/counselor/recommendations";
import { EmptyIcon } from "@/components/ui/empty-icon";

/**
 * What this counselor has advised, and what came of it.
 *
 * THE DECLINED COLUMN IS THE POINT. lib/counselor/recommendations.ts calls
 * DECLINED_BY_COUNSELOR the most interesting value in the table — a judgement
 * the model never made, recorded nowhere else in the product. Until this page
 * existed it was written down and never shown back to the person who wrote it.
 *
 * GROUPED BY WHAT HAPPENED TO THE ADVICE, never by student. Every count here
 * counts recommendations; a count of students would be the first column of a
 * league table, and the patterns panel below is phrased as something noticed
 * rather than something concluded for the same reason.
 *
 * The patterns panel LIVES HERE NOW rather than at the foot of This week. It is
 * retrospective, and This week is the job — a pattern about last term's advice
 * had no business on the screen a counselor opens to decide about Saturday.
 */
export default async function AdvicePage() {
  const [log, patterns] = await Promise.all([
    loadAdviceLog(),
    loadFollowThroughPatterns(),
  ]);

  if (log.total === 0) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <div className="flex items-center gap-3">
            <EmptyIcon className="h-9 w-9" />
            <h2 className="text-sm font-medium text-zinc-500">
              Nothing recorded yet
            </h2>
          </div>
          <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Options appear here once you draft a session prep and decide what to
            pass on. What you choose not to deliver is kept too — over a few
            terms that is the part worth reading back.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading />

      <section className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-white/5">
        <p className="text-sm">
          <strong className="font-semibold">{log.total}</strong>{" "}
          {log.total === 1 ? "option" : "options"} drafted.{" "}
          <span className="text-zinc-500">
            {log.delivered.length + log.acceptedByStudent.length} passed on,{" "}
            {log.declined.length} set aside,{" "}
            {log.awaitingDecision.length} still to decide.
          </span>
        </p>
      </section>

      {patterns.length > 0 && (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">
            Noticed across your caseload
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            About the advice, not about you and not about the students. Nothing
            here is a score, and nothing here is compared to another counselor.
          </p>
          <ul className="mt-3 space-y-2">
            {patterns.map((p, i) => (
              <li key={i} className="text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  {p.observation}
                </span>{" "}
                {/* The counts are shown so a counselor can discount the
                    observation themselves rather than take our word for how
                    much it means. */}
                <span className="text-zinc-500">{p.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Group
        title="Still to decide"
        note="Drafted in a prep and not yet passed on or set aside."
        rows={log.awaitingDecision}
      />
      <Group
        title="Set aside"
        note="What you chose not to pass on. The only record anywhere of a judgement the app did not make."
        rows={log.declined}
        showDeclineReason
      />
      <Group
        title="Taken up by the student"
        note="Delivered, and the student turned it into a commitment of their own."
        rows={log.acceptedByStudent}
      />
      <Group
        title="Delivered"
        note="Passed on in a session. Whether anything came of it is the student's to record."
        rows={log.delivered}
      />

      <p className="text-xs leading-relaxed text-zinc-500">
        There is no success rate on this page, and no comparison with any other
        counselor. A recommendation nobody acted on is at least as likely to
        have been the wrong recommendation as the wrong student, and a number
        claiming otherwise would be measuring you with a sample far too small to
        mean anything.
      </p>
    </div>
  );
}

function PageHeading() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Advice</h1>
      <p className="mt-1 text-sm text-zinc-500">
        What you passed on, what you set aside, and what came of it.
      </p>
    </div>
  );
}

function Group({
  title,
  note,
  rows,
  showDeclineReason = false,
}: {
  title: string;
  note: string;
  rows: AdviceRow[];
  showDeclineReason?: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-500">{title}</h2>
        <span className="text-xs text-zinc-400">{rows.length}</span>
      </div>
      <p className="mt-0.5 text-xs text-zinc-500">{note}</p>
      <ul className="mt-3 space-y-4">
        {rows.map((r) => (
          <li
            key={r.id}
            className="border-t border-black/5 pt-3 first:border-0 first:pt-0 dark:border-white/10"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link
                href={`/caseload/${r.linkId}`}
                className="text-sm font-medium hover:underline"
              >
                {r.studentName}
              </Link>
              <span className="text-xs text-zinc-500">
                {r.gradeLevel ?? "Grade not set"}
              </span>
              <span className="text-xs text-zinc-400">
                {(r.deliveredAt ?? r.createdAt).toLocaleDateString("en-US", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              {/* Whether the words were the app's or the counselor's own. A
                  counselor reading their log back should not have to guess
                  which of the two they are looking at. */}
              <span className="text-xs text-zinc-400">
                {r.source === "COUNSELOR_AUTHORED" ? "your own" : "drafted"}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {r.text}
            </p>
            {/* The basis, kept with the advice. It is what makes an old call
                traceable rather than something a counselor has to take on
                trust months later. */}
            <p className="mt-1 font-mono text-xs text-zinc-500">{r.basis}</p>
            {showDeclineReason && r.declineReason && (
              <p className="mt-2 border-l-2 border-black/10 pl-3 text-sm text-zinc-600 dark:border-white/15 dark:text-zinc-400">
                {r.declineReason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
