import Link from "next/link";
import { redirect } from "next/navigation";
import { getCounselorAccount } from "@/lib/counselor/access";
import {
  CASELOAD_BANDS,
  bandForLimit,
  caseloadStanding,
} from "@/lib/testprep/entitlement";

/**
 * Plans, and what happens when a tutor is over their band.
 *
 * Reached only from the notice in the layout, and reachable directly. It is a
 * page rather than a modal for the same reason the notice is a strip rather
 * than an interstitial: nothing about billing may sit between a tutor and a
 * student they are mid-session with.
 *
 * WHAT THIS PAGE DOES NOT DO is more important than what it does. It does not
 * auto-upgrade, it does not disable anything, and it does not put a countdown
 * on the over-band state. A tutor reading this is being told a fact and offered
 * an option; the choice and the timing are theirs.
 */
export default async function TutorPlanPage() {
  const account = await getCounselorAccount();
  // The layout already gates this route group; the redirect here is for the
  // concurrent-render case, where a page's queries run before a layout's
  // redirect takes effect.
  if (!account || account.type !== "TEST_PREP_TUTOR") redirect("/start");

  const standing = await caseloadStanding(account.id);
  const currentBand = bandForLimit(standing.limit);

  return (
    <div className="space-y-6">
      <Link
        href="/students-testprep"
        className="text-sm font-medium text-zinc-500 hover:text-foreground"
      >
        ← Students
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Priced by how many students you are actively working with. Billed
          monthly, cancel whenever.
        </p>
      </div>

      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">Where you stand</h2>
        <p className="mt-2 text-lg">
          <strong className="tabular-nums">{standing.active}</strong> active
          student{standing.active === 1 ? "" : "s"} · plan covers{" "}
          <strong className="tabular-nums">{standing.limit}</strong>
          {currentBand && (
            <span className="text-zinc-500"> (${currentBand.monthlyUsd}/mo)</span>
          )}
        </p>
        {standing.overBand ? (
          <p className="mt-2 max-w-2xl text-sm text-amber-800 dark:text-amber-200">
            {standing.message}
          </p>
        ) : (
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Inside your band. A student stops counting the moment their link
            ends — including automatically, in the June they graduate.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">The bands</h2>
        <ul className="mt-3 space-y-2">
          {CASELOAD_BANDS.map((band) => {
            const isCurrent = band.students === standing.limit;
            const covers = band.students >= standing.active;
            return (
              <li
                key={band.code}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-black/10 px-4 py-3 dark:border-white/10"
              >
                <span className="font-medium">
                  Up to {band.students} students
                  {isCurrent && (
                    <span className="ml-2 rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
                      your plan
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                  ${band.monthlyUsd}/mo
                  {!isCurrent && !covers && (
                    <span className="ml-2 text-xs text-zinc-500">
                      below your current caseload
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {/* Changing a plan happens on the web, through Stripe, and is not wired
            up in this build. Said plainly rather than rendered as a button that
            does nothing — a dead checkout button is worse than none, because a
            tutor over their band would think they had already moved. */}
        <p className="mt-4 border-t border-black/10 pt-3 text-xs text-zinc-500 dark:border-white/10">
          Plan changes are handled on the web and billed through Stripe. Checkout
          is not connected in this build — to move bands, get in touch and we
          will do it by hand.
        </p>
      </section>

      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">
          What being over a band does not do
        </h2>
        {/* Written down where a customer can read it, because a promise made
            only in a code comment is not a promise. */}
        <ul className="mt-2 max-w-2xl list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>Nothing is disabled, hidden or held back. Sessions carry on.</li>
          <li>
            You are never upgraded automatically. Moving bands is something you
            do, not something that happens to you.
          </li>
          <li>
            Students still reach their target and you are still told when they
            do. That signal is not part of any plan and never will be — it is
            the one thing this product is for.
          </li>
        </ul>
      </section>
    </div>
  );
}
