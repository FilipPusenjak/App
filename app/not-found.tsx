import Link from "next/link";

/**
 * A page that is not there — either a mistyped URL, or a deliberate notFound().
 *
 * THE DELIBERATE CASES ARE WHY THE WORDING IS CAREFUL. Several routes call
 * notFound() for something that DOES exist but is not this account's to see: an
 * evaluation belonging to someone else, a caseload link whose consent has
 * lapsed, the operations page viewed by a non-operator. That is a deliberate
 * choice — a 403 would confirm the thing exists, and confirming existence is
 * itself a disclosure — so this page must not undo it by saying "you do not
 * have permission to view this", which tells the visitor exactly what a 403
 * would have.
 *
 * So it says the page is not here and offers a way onward, for every case,
 * without distinguishing between them. Somebody who typed a URL wrong and
 * somebody probing for another student's records get the same answer.
 *
 * Links to /start rather than /dashboard: it decides where an account belongs,
 * so a counselor landing here is not sent to a student surface they have no
 * business on.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight">
          This page is not here
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The link may be out of date, or the address may have a typo in it.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/start"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Go to your account
          </Link>
          <Link
            href="/"
            className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            CourseChart home
          </Link>
        </div>
      </div>
    </main>
  );
}
