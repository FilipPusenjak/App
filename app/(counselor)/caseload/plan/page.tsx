import Link from "next/link";
import { redirect } from "next/navigation";
import { getCounselorAccount } from "@/lib/counselor/access";
import { counselorStanding } from "@/lib/counselor/entitlement";
import { loadBillingSummary } from "@/lib/billing/subscription";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { COUNSELOR_BANDS, stripePriceIdFor, type Plan } from "@/lib/billing/plans";
import {
  CheckoutButton,
  PortalButton,
} from "@/app/(app)/settings/billing/buttons";

/**
 * What the plan covers, and how to change it.
 *
 * This page exists because two API routes refuse work and tell the counselor to
 * raise their plan. Before it there was no plan to raise: the ceiling was a
 * column somebody set by hand, so a counselor who filled their caseload was
 * stopped with an instruction they could not follow.
 *
 * IT IS HONEST ABOUT THE REFUSAL rather than quiet about it. A counselor at
 * their limit cannot add a student and cannot draft prep for one past the
 * ceiling, and a plans page that showed only prices would leave them to
 * rediscover that by being blocked again. What it does NOT do is dramatise it:
 * no countdown, no interstitial, nothing between a counselor and a student
 * already on their caseload.
 */
export default async function CounselorPlanPage() {
  const account = await getCounselorAccount();
  // The layout gates this route group; this covers the concurrent-render case,
  // where a page's queries run before a layout's redirect takes effect.
  if (!account) redirect("/start");
  // The test-prep edition has its own plans page against its own bands.
  if (account.type === "TEST_PREP_TUTOR") redirect("/students-testprep/plan");

  const [standing, billing] = await Promise.all([
    counselorStanding(account.id),
    loadBillingSummary(account.userId, "COUNSELOR"),
  ]);
  const stripeReady = isStripeConfigured();

  return (
    <div className="space-y-6">
      <Link
        href="/caseload"
        className="text-sm font-medium text-zinc-500 hover:text-foreground"
      >
        ← This week
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Priced by how many students you are actively working with. Billed
          monthly, cancel whenever.
        </p>
      </div>

      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">Where you stand</h2>
        <p className="mt-2 text-lg">
          <strong className="font-semibold tabular-nums">
            {standing.active}
          </strong>{" "}
          <span className="text-zinc-500">
            of {standing.limit} active students
          </span>
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {standing.plan
            ? `On ${standing.plan.name.toLowerCase()}, $${standing.plan.monthlyUsd} a month.`
            : "No plan on this account — the limit is the one set when it was created."}
        </p>

        {/* Said here rather than only in an API error, because the counselor
            who needs it may have hit the refusal days ago. */}
        {standing.atLimit && (
          <p className="mt-3 max-w-2xl rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <strong className="font-semibold">You are at your limit.</strong>{" "}
            {standing.suggested
              ? `Adding another student needs the ${standing.suggested.name.toLowerCase()} plan. Nothing you already have is affected — every student on your caseload stays visible and their prep keeps working.`
              : "You are past the largest standard plan. Get in touch and we will sort out something that fits."}
          </p>
        )}

        {billing.hasCustomer && stripeReady && (
          <div className="mt-4">
            <PortalButton />
            <p className="mt-1.5 text-xs text-zinc-500">
              Change or cancel your plan, update your card, and download
              receipts. Cancelling takes as few clicks as subscribing did.
            </p>
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {COUNSELOR_BANDS.map((plan) => (
          <BandCard
            key={plan.code}
            plan={plan}
            current={standing.plan?.code === plan.code}
            active={standing.active}
            stripeReady={stripeReady}
          />
        ))}
      </div>

      {/* Said plainly rather than rendered as a dead button — a checkout that
          does nothing is worse than none, because somebody presses it and
          reasonably concludes they have paid. */}
      {!stripeReady && (
        <p className="rounded-lg border border-black/10 bg-white p-4 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
          Payments are not connected on this deployment, so there is nothing to
          buy here yet. The limit on this account is whatever it was set to.
        </p>
      )}

      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">
          What a plan never affects
        </h2>
        <ul className="mt-2 max-w-2xl list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            A student&apos;s consent. Nothing here grants access — a caseload
            link still needs the student and their guardian to agree, and
            either can end it at any time.
          </li>
          <li>
            Students already on your caseload. Going over a limit never hides a
            student you are working with, and never deletes anything.
          </li>
          <li>
            Triage. Watching the whole caseload for who needs you calls no
            model and costs nothing, on any plan.
          </li>
        </ul>
      </section>
    </div>
  );
}

function BandCard({
  plan,
  current,
  active,
  stripeReady,
}: {
  plan: Plan;
  current: boolean;
  /** So a band that could not hold this caseload is not offered as a fix. */
  active: number;
  stripeReady: boolean;
}) {
  const priceId = stripePriceIdFor(plan);
  const covers = (plan.caseloadLimit ?? 0) >= active;
  const purchasable = stripeReady && priceId !== null && !current;

  return (
    <section
      className={`rounded-xl border p-5 ${
        current
          ? "border-zinc-900 bg-white dark:border-white dark:bg-white/5"
          : "border-black/10 bg-white dark:border-white/15 dark:bg-white/5"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{plan.name}</h3>
        {current && (
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
            your plan
          </span>
        )}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        ${plan.monthlyUsd}
        <span className="text-sm font-normal text-zinc-500">/mo</span>
      </p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {plan.summary}
      </p>
      {purchasable && (
        <div className="mt-4">
          <CheckoutButton
            planCode={plan.code}
            label={`Move to ${plan.name.toLowerCase()}`}
          />
          {/* A band smaller than the caseload would be bought and immediately
              be over its own limit. Offered anyway — moving down is a real
              thing to want — but never without saying so first. */}
          {!covers && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
              You have {active} active students, so this band would already be
              over its limit.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
