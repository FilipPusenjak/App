import Link from "next/link";
import {
  loadCaseloadCommitments,
  describeDue,
  type CommitmentRow,
} from "@/lib/counselor/commitments";
import { EmptyIcon } from "@/components/ui/empty-icon";

/**
 * Everything students agreed to, across the caseload, in date order.
 *
 * ORDERED BY WHEN, NOT BY WHO. This week orders by who needs attention; this
 * screen orders by what is about to matter, which is a different question with
 * a different answer. Neither of them orders students by how they are doing,
 * and there is no number on this page attached to a person.
 *
 * NOTHING HERE IS A CHECKBOX. A commitment belongs to the student who accepted
 * it, and only they can say it is done — see lib/counselor/commitments.ts. What
 * this screen produces is a conversation, not a tick.
 */
export default async function CommitmentsPage() {
  const c = await loadCaseloadCommitments();

  if (c.totalActive === 0) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <div className="flex items-center gap-3">
            <EmptyIcon className="h-9 w-9" />
            <h2 className="text-sm font-medium text-zinc-500">No students yet</h2>
          </div>
          <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
            This fills in once a student appears on your caseload and agrees to
            something.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading />

      {/* The count first, like the attention list. A counselor opening this on
          a Sunday evening wants the size of the thing before the detail. */}
      <section className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-white/5">
        <p className="text-sm">
          <strong className="font-semibold">{c.liveCount}</strong>{" "}
          {c.liveCount === 1 ? "commitment is" : "commitments are"} open across
          your caseload.
          {c.overdue.length > 0 && (
            <>
              {" "}
              <strong className="font-semibold">{c.overdue.length}</strong>{" "}
              {c.overdue.length === 1 ? "is past its date" : "are past their date"}.
            </>
          )}
          {c.studentsWithNothingLive > 0 && (
            <>
              {" "}
              <span className="text-zinc-500">
                {c.studentsWithNothingLive} of {c.totalActive}{" "}
                {c.studentsWithNothingLive === 1 ? "student has" : "students have"}{" "}
                nothing outstanding.
              </span>
            </>
          )}
        </p>
      </section>

      <Group
        title="Past its date"
        note="Longest overdue first — something three weeks late has already been missed once."
        rows={c.overdue}
        tone="overdue"
      />
      <Group
        title="Due this week"
        note="The reason this screen exists. Triage will not raise any of these until they are already late."
        rows={c.soon}
        tone="soon"
      />
      <Group
        title="Later"
        note="Agreed to, with time in hand."
        rows={c.later}
        tone="plain"
      />
      {/* Its own group, deliberately. A proposal nobody answered is an
          unanswered suggestion from the app, not a promise a student broke,
          and putting the two in one list would quietly blame a child for the
          app's unread advice. */}
      <Group
        title="Proposed, never answered"
        note="Suggested to the student and not yet accepted or declined. Not a missed commitment — nobody has agreed to these."
        rows={c.unanswered}
        tone="plain"
      />
      <Group
        title="Closed in the last month"
        note="Finished or abandoned. What someone drops is worth seeing next to what they finish."
        rows={c.recentlyClosed}
        tone="closed"
      />

      <p className="text-xs leading-relaxed text-zinc-500">
        Nothing on this page can be ticked off. A commitment belongs to the
        student who accepted it, and marking it done is theirs to do — this
        surface can read their record and never write to it.
      </p>
    </div>
  );
}

function PageHeading() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Commitments</h1>
      <p className="mt-1 text-sm text-zinc-500">
        What students have agreed to, by when. Ordered by date, not by student.
      </p>
    </div>
  );
}

function Group({
  title,
  note,
  rows,
  tone,
}: {
  title: string;
  note: string;
  rows: CommitmentRow[];
  tone: "overdue" | "soon" | "plain" | "closed";
}) {
  if (rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-500">{title}</h2>
        <span className="text-xs text-zinc-400">{rows.length}</span>
      </div>
      <p className="mt-0.5 text-xs text-zinc-500">{note}</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="border-t border-black/5 pt-3 first:border-0 first:pt-0 dark:border-white/10">
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
              <span className={`text-xs ${dueClass(tone)}`}>
                {tone === "closed"
                  ? r.status.toLowerCase()
                  : describeDue(r)}
              </span>
              {tone !== "closed" && r.status !== "PROPOSED" && (
                <span className="text-xs text-zinc-400">
                  {r.status.toLowerCase().replace("_", " ")}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {r.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Colour carries urgency, and the words carry it too — see describeDue. */
function dueClass(tone: "overdue" | "soon" | "plain" | "closed"): string {
  if (tone === "overdue") return "font-medium text-red-600 dark:text-red-400";
  if (tone === "soon") return "font-medium text-amber-700 dark:text-amber-400";
  return "text-zinc-500";
}
