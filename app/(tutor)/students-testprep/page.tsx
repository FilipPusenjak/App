import Link from "next/link";
import { loadRoster } from "@/lib/testprep/roster";

/**
 * The tutor's students, alphabetically.
 *
 * NOT ordered by score, progress or improvement, and there is a test reading
 * lib/testprep/roster.ts to keep it that way. A test-prep roster sorted by
 * improvement is a leaderboard of children — it invites a comparison families
 * would be appalled to learn was being made, and it would be the first
 * screenshot to leak.
 *
 * The one thing that IS surfaced above the name is an unacknowledged stopping
 * signal, because that is a conversation the tutor owes a family and it must
 * not be something they can scroll past. It is a boolean, not a rank.
 */
export default async function TutorStudentsPage() {
  const rows = await loadRoster();
  const owed = rows.filter((r) => r.needsStoppingAcknowledgement);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Alphabetical. This list is never ordered by score or improvement.
        </p>
      </div>

      {rows.length === 0 ? (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <h2 className="text-sm font-medium text-zinc-500">No students yet</h2>
          <p className="mt-1 max-w-2xl text-zinc-600 dark:text-zinc-400">
            A student appears here once they have given you an invite code and
            both they and a parent or guardian have agreed. Until then you can
            see nothing about them, which is deliberate.
          </p>
        </section>
      ) : (
        <>
          {owed.length > 0 && (
            /* Above the list, and unmissable. This is the product's whole
               claim: when the work is done, the tutor is told, and telling the
               family is on them. */
            <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/30">
              <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                {owed.length === 1
                  ? "One student has reached their target"
                  : `${owed.length} students have reached their target`}
              </h2>
              <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                More points would not change an admission outcome for{" "}
                {owed.map((r) => r.studentName).join(", ")}. Open them to see why,
                and to acknowledge it.
              </p>
            </section>
          )}

          <ul className="divide-y divide-black/10 rounded-lg border border-black/10 bg-white dark:divide-white/10 dark:border-white/15 dark:bg-white/5">
            {rows.map((row) => (
              <li
                key={row.linkId}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/students-testprep/${row.linkId}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {row.studentName}
                  </Link>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {row.gradeLevel ?? "Grade not set"}
                    {row.graduationYear && ` · leaves ${row.graduationYear}`}
                  </p>
                </div>
                {row.stoppingLabel && (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                    {row.stoppingLabel}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
