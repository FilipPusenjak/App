import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getOwnedProfiles } from "@/lib/ownership";
import { studentLabel } from "@/lib/students";
import { loadDashboard } from "@/lib/dashboard/load";
import { describeMovement } from "@/lib/dashboard/summary";

const card =
  "rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5";

export default async function DashboardPage() {
  const [user, profiles, data] = await Promise.all([
    getCurrentUser(),
    getOwnedProfiles(),
    loadDashboard(),
  ]);
  const multiStudent = profiles.length > 1;
  const { latest, gaps } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome{user?.name ? `, ${user.name}` : ""}.
        </h1>
        {multiStudent ? (
          // Whose data is on screen. An account running several students needs
          // this on the page itself — every link below acts on ONE of them, and
          // a counselor who has lost track edits the wrong child's record.
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            You&apos;re working on{" "}
            <strong className="font-semibold text-foreground">
              {studentLabel(data.studentLabelSource)}
            </strong>
            . Everything below applies to them —{" "}
            <Link href="/students" className="underline underline-offset-2">
              switch or manage students
            </Link>
            .
          </p>
        ) : (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            You&apos;re signed in. This is your private dashboard.
          </p>
        )}
      </div>

      {latest ? (
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-zinc-500">
                Where you stand
              </h2>
              <p className="mt-1 max-w-2xl text-lg font-medium leading-snug">
                {latest.headline}
              </p>
            </div>
            <Link
              href={`/evaluations/${latest.id}`}
              className="shrink-0 rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Full evaluation
            </Link>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Score
              label="Readiness for your targets"
              value={latest.overallScore}
              note={describeMovement(data.overallMove)}
            />
            <Score
              label="Compared to your year"
              value={latest.gradeRelativeScore}
              note={describeMovement(data.gradeRelativeMove)}
            />
          </div>

          {/* Kept separate on purpose: one number blended across the US and UK
              systems is a number about nothing, which is the flattening this
              app exists to avoid. */}
          {latest.systemScores.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-black/10 pt-3 text-sm text-zinc-600 dark:border-white/10 dark:text-zinc-400">
              {latest.systemScores.map((s) => (
                <span key={s.rubricId}>
                  {s.systemLabel}:{" "}
                  <strong className="font-semibold text-foreground">
                    {s.readinessScore}
                  </strong>
                </span>
              ))}
            </div>
          )}

          {data.stale && (
            <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              You&apos;ve changed your profile since this ran, so these numbers
              describe an older version of it.{" "}
              <Link href="/evaluations" className="font-medium underline">
                Run a new evaluation
              </Link>
              .
            </p>
          )}
        </section>
      ) : (
        <section className={card}>
          <h2 className="text-sm font-medium text-zinc-500">
            No evaluation yet
          </h2>
          <p className="mt-1 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Build your profile, add the universities you&apos;re aiming at, then
            run an evaluation for an honest read on how your profile fits each
            one — judged by that country&apos;s admissions rubric.
          </p>
        </section>
      )}

      {latest && latest.actions.length > 0 && (
        <section className={card}>
          <h2 className="text-sm font-medium text-zinc-500">Do this next</h2>
          {/* Array order IS the priority — the model is asked to rank these. */}
          <ol className="mt-3 space-y-3">
            {latest.actions.slice(0, 3).map((action, i) => (
              <li key={`${action.title}-${i}`} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{action.title}</p>
                  <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                    {action.detail}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {action.effort} effort · {action.impact} impact ·{" "}
                    {action.timeframe}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {latest.actions.length > 3 && (
            <Link
              href={`/evaluations/${latest.id}`}
              className="mt-4 inline-block text-sm font-medium underline underline-offset-2"
            >
              {latest.actions.length - 3} more in the full evaluation
            </Link>
          )}
        </section>
      )}

      {gaps.length > 0 && (
        <section className={card}>
          <h2 className="text-sm font-medium text-zinc-500">
            {latest
              ? "This would make your next evaluation sharper"
              : "Before you evaluate"}
          </h2>
          <ul className="mt-3 space-y-3">
            {gaps.map((gap) => (
              <li key={gap.id}>
                <Link
                  href={gap.href}
                  className="font-medium underline underline-offset-2"
                >
                  {gap.label}
                </Link>
                <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                  {gap.why}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Stacked full width on a phone: wrapped, ragged-width buttons read as
          debris, and a 32px-tall link is not a touch target. Back to a wrapping
          row from tablet up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href="/profile"
          className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 sm:py-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Build your profile
        </Link>
        <Link
          href="/targets"
          className="inline-flex items-center justify-center rounded-md border border-black/15 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 sm:py-2 dark:border-white/20 dark:hover:bg-white/10"
        >
          Set your targets
        </Link>
        <Link
          href="/evaluations"
          className="inline-flex items-center justify-center rounded-md border border-black/15 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 sm:py-2 dark:border-white/20 dark:hover:bg-white/10"
        >
          {latest ? "Run a new evaluation" : "Evaluate my profile"}
        </Link>
      </div>
    </div>
  );
}

function Score({
  label,
  value,
  note,
}: {
  label: string;
  value: number | null;
  note: string;
}) {
  return (
    <div>
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-0.5 text-3xl font-semibold tabular-nums">
        {value ?? "—"}
        {value != null && (
          <span className="ml-1 text-base font-normal text-zinc-400">/100</span>
        )}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{note}</p>
    </div>
  );
}
