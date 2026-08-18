import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getOwnedProfiles } from "@/lib/ownership";
import { studentLabel } from "@/lib/students";
import { loadDashboard } from "@/lib/dashboard/load";
import { describeMovement } from "@/lib/dashboard/summary";
import { BAND_MEANINGS, PACE_LABELS } from "@/lib/dashboard/standing";

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

          {/* Two readings, never one. Which pair depends on which instrument
              produced this evaluation — and a band is never converted into a
              score, or a score into a band, to make the layout uniform. */}
          {latest.standing.kind === "percentile" && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Score
                label="Readiness for your targets"
                value={latest.standing.readiness}
                note={describeMovement(data.overallMove)}
              />
              <Score
                label="Compared to your year"
                value={latest.standing.forYourYear}
                note={describeMovement(data.gradeRelativeMove)}
              />
            </div>
          )}

          {latest.standing.kind === "band" && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Band
                label="Requirements"
                value={latest.standing.requirements}
                note="Caps at met — a requirement can't be more than satisfied."
              />
              <Band
                label="Differentiation"
                value={latest.standing.differentiation}
                note="No ceiling — depth keeps counting."
              />
            </div>
          )}

          {latest.standing.kind === "band" && latest.standing.pace && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              {PACE_LABELS[latest.standing.pace] ?? latest.standing.pace}
            </p>
          )}

          {/* Kept separate on purpose: one number blended across the US and UK
              systems is a number about nothing, which is the flattening this
              app exists to avoid. */}
          {latest.standing.kind === "percentile" &&
            latest.standing.perSystem.length > 1 && (
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-black/10 pt-3 text-sm text-zinc-600 dark:border-white/10 dark:text-zinc-400">
                {latest.standing.perSystem.map((s) => (
                  <span key={s.label}>
                    {s.label}:{" "}
                    <strong className="font-semibold text-foreground">
                      {s.score}
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

      {latest && latest.nextSteps.length > 0 && (
        <section className={card}>
          <h2 className="text-sm font-medium text-zinc-500">Do this next</h2>
          {/* Array order IS the priority — a legacy evaluation ranks its
              actions, a deep review orders commitments by status then due
              date, and a check-in has exactly one. */}
          <ol className="mt-3 space-y-3">
            {latest.nextSteps.map((step, i) => (
              <li key={step.commitmentId ?? `${step.title}-${i}`} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-white dark:text-zinc-900">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{step.title}</p>
                  {step.detail && (
                    <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                      {step.detail}
                    </p>
                  )}
                  {step.meta && (
                    <p className="mt-1 text-xs text-zinc-500">{step.meta}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {latest.moreCount > 0 && (
            <Link
              href={`/evaluations/${latest.id}`}
              className="mt-4 inline-block text-sm font-medium underline underline-offset-2"
            >
              {latest.moreCount} more in the full {latest.label.toLowerCase()}
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

/**
 * The band counterpart to Score.
 *
 * Deliberately NOT rendered as a number, a bar, or a position on a scale: a
 * band is an ordinal judgement, and drawing it as 3/4 of something would put a
 * precision on it that the underlying measurement does not have. The meaning
 * line carries the weight instead, because a bare "developing" tells a student
 * nothing about whether they are doing well.
 */
function Band({
  label,
  value,
  note,
}: {
  label: string;
  value: string | null;
  note: string;
}) {
  return (
    <div>
      <p className="text-sm text-zinc-500">{label}</p>
      {/* first-letter, NOT `capitalize` — see the note in deep-review-body. */}
      <p className="mt-0.5 text-2xl font-semibold leading-tight first-letter:uppercase">
        {value ?? "—"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        {(value && BAND_MEANINGS[value]) ?? note}
      </p>
    </div>
  );
}
