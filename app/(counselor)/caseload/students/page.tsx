import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadCaseloadDirectory } from "@/lib/counselor/caseload";
import { requireCounselorPage } from "@/lib/counselor/access";
import { SCOPE_MEANINGS, type LinkScope } from "@/lib/validation/counselor";
import { RedeemInvite } from "./redeem-invite";

/**
 * The student directory — SECONDARY navigation, reached deliberately.
 *
 * Sorted by name. That is not a default nobody thought about: every other
 * ordering a caseload directory could take is a ranking by something, and the
 * candidates are precisely the measures this product refuses to compute. A
 * counselor looking for one student by name gets an alphabetical list; a
 * counselor deciding where to spend the day gets the attention list instead.
 */
export default async function CaseloadDirectoryPage() {
  const account = await requireCounselorPage();
  const [rows, pendingCount] = await Promise.all([
    loadCaseloadDirectory(),
    // A COUNT, and nothing else. Reading anything about a pending student would
    // be reading a record nobody has consented to yet.
    prisma.caseloadLink.count({
      where: {
        counselorAccountId: account.id,
        status: "PENDING",
        endedAt: null,
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Everyone you have access to, alphabetically. For deciding where your
          time goes, use{" "}
          <Link href="/caseload" className="underline underline-offset-2">
            this week
          </Link>
          .
        </p>
      </div>

      {/* Pending links deliberately do not appear in the list below — there is
          nothing about them a counselor is entitled to see yet — so the count
          is stated here, or an invitation waiting on a guardian would look like
          a code that never worked. */}
      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">Add a student</h2>
        {pendingCount > 0 && (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {pendingCount === 1
              ? "One invitation is waiting on a parent or guardian."
              : `${pendingCount} invitations are waiting on a parent or guardian.`}
          </p>
        )}
        <div className="mt-3">
          <RedeemInvite />
        </div>
      </section>

      {rows.length === 0 ? (
        <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
          <p className="text-zinc-600 dark:text-zinc-400">
            No active students. A link becomes active once both the student and
            a guardian approve it.
          </p>
        </section>
      ) : (
        <ul className="divide-y divide-black/10 rounded-lg border border-black/10 bg-white dark:divide-white/10 dark:border-white/15 dark:bg-white/5">
          {rows.map((row) => (
            <li
              key={row.linkId}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <Link
                  href={`/caseload/${row.linkId}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {row.studentName}
                </Link>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {row.gradeLevel ?? "Grade not set"}
                  {" · "}
                  {/* The scope, stated on every row. A counselor who forgets
                      they are on ACADEMIC_ONLY will read an absent activity as
                      an absent activity rather than as an absent permission. */}
                  <span title={SCOPE_MEANINGS[row.scope as LinkScope]}>
                    {row.scope === "FULL"
                      ? "full access"
                      : row.scope === "ACADEMIC_ONLY"
                        ? "academic records only"
                        : "activities only"}
                  </span>
                  {row.lastHeldAt && (
                    <>
                      {" · last met "}
                      {row.lastHeldAt.toLocaleDateString("en-US", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </>
                  )}
                </p>
              </div>
              {/* A count of open signals, never a score. "3 things to look at"
                  is an amount of work; anything else here would be a grade. */}
              <span className="shrink-0 text-xs text-zinc-500">
                {row.openSignalCount === 0
                  ? "nothing open"
                  : `${row.openSignalCount} to look at`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
