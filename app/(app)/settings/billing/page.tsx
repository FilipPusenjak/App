import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { loadBillingSummary } from "@/lib/billing/subscription";
import { plansFor, stripePriceIdFor, type Plan } from "@/lib/billing/plans";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { getSpendStatus } from "@/lib/spending-account";
import { formatUsd } from "@/lib/cost";
import { CheckoutButton, PortalButton } from "./buttons";

/**
 * What this account is on, and how to change it.
 *
 * The one thing this page must never imply is that lapsing costs somebody their
 * records. A plan raises the ceiling on NEW model runs and does nothing else —
 * every evaluation already run, every profile, every score stays readable and
 * exportable on the free plan forever. See planMayGate in lib/billing.
 */
export default async function BillingPage() {
  const userId = await requireUserId().catch(() => null);
  if (!userId) redirect("/login");

  const [summary, spend] = await Promise.all([
    loadBillingSummary(userId, "STUDENT"),
    getSpendStatus(),
  ]);
  const configured = isStripeConfigured();
  const plans = plansFor("STUDENT");

  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="text-sm font-medium text-zinc-500 hover:text-foreground"
      >
        ← Settings
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
        <p className="mt-1 text-sm text-zinc-500">
          A plan raises how much model work this account can do. It does not
          affect what you can see or export.
        </p>
      </div>

      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">Where you stand</h2>
        <p className="mt-2 text-lg">
          <strong className="font-semibold">
            {summary.plan?.name ?? "Free"}
          </strong>
          {summary.plan && summary.plan.monthlyUsd > 0 && (
            <span className="text-zinc-500">
              {" "}
              · ${summary.plan.monthlyUsd}/mo
            </span>
          )}
        </p>

        {/* The lapse sentence. Somebody whose card expired needs to be told
            that, not shown "Free" with no explanation and left to assume the
            app lost their payment. */}
        {summary.status && summary.status !== "active" && (
          <p className="mt-2 max-w-2xl text-sm text-amber-800 dark:text-amber-200">
            {describeStatus(summary.status, summary.currentPeriodEnd)}
          </p>
        )}
        {summary.cancelAtPeriodEnd && summary.currentPeriodEnd && (
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Cancelled — your plan runs until{" "}
            {summary.currentPeriodEnd.toLocaleDateString("en-US", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            . You keep everything you paid for until then.
          </p>
        )}

        {!spend.unlimited && (
          <p className="mt-3 border-t border-black/10 pt-3 text-sm text-zinc-600 dark:border-white/15 dark:text-zinc-400">
            Model budget used:{" "}
            <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatUsd(spend.spentUsd) ?? "$0.00"} of{" "}
              {formatUsd(spend.limitUsd)}
            </span>
            {spend.allowed ? "" : " — new runs are paused"}.
          </p>
        )}

        {summary.hasCustomer && configured && (
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
        {plans.map((plan) => (
          <PlanCard
            key={plan.code}
            plan={plan}
            current={summary.plan?.code === plan.code}
            configured={configured}
          />
        ))}
      </div>

      {/* Said plainly rather than rendered as a dead button. A checkout button
          that does nothing is worse than none: somebody presses it, nothing
          happens, and they reasonably conclude they have paid. */}
      {!configured && (
        <p className="rounded-lg border border-black/10 bg-white p-4 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
          Payments are not connected on this deployment, so there is nothing to
          buy here yet. Everything on the free plan works as normal.
        </p>
      )}

      <section className="rounded-lg border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-sm font-medium text-zinc-500">
          What a plan never affects
        </h2>
        {/* Written where a customer can read it, because a promise that lives
            only in a code comment is not a promise. */}
        <ul className="mt-2 max-w-2xl list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            Every evaluation you have already run stays readable, forever, on
            any plan.
          </li>
          <li>
            Your profile, targets and scores are yours. They are never hidden
            behind a payment, and{" "}
            <Link href="/api/export" className="underline underline-offset-2">
              export
            </Link>{" "}
            keeps working on the free plan.
          </li>
          <li>
            Nothing is deleted if a plan lapses. You drop back to the free
            budget and keep everything else.
          </li>
        </ul>
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  configured,
}: {
  plan: Plan;
  current: boolean;
  configured: boolean;
}) {
  const priceId = stripePriceIdFor(plan);
  const purchasable = configured && priceId !== null && !current;

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
        {plan.monthlyUsd === 0 ? "Free" : `$${plan.monthlyUsd}`}
        {plan.monthlyUsd > 0 && (
          <span className="text-sm font-normal text-zinc-500">/mo</span>
        )}
      </p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {plan.summary}
      </p>
      {plan.spendLimitUsd !== undefined && (
        <p className="mt-2 text-xs text-zinc-500">
          Up to ${plan.spendLimitUsd} of model work per month across every
          student on the account.
        </p>
      )}
      {purchasable && (
        <div className="mt-4">
          <CheckoutButton planCode={plan.code} label={`Move to ${plan.name}`} />
        </div>
      )}
    </section>
  );
}

/** Stripe's status in words a customer can act on. */
function describeStatus(status: string, periodEnd: Date | null): string {
  const until = periodEnd
    ? ` until ${periodEnd.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
      })}`
    : "";
  switch (status) {
    case "past_due":
      return `We could not take the last payment — usually an expired card. Your plan keeps working${until}. Update your card and nothing changes.`;
    case "unpaid":
      return "The last payment did not go through and the plan has ended. Updating your card will start it again.";
    case "canceled":
      return periodEnd && periodEnd > new Date()
        ? `Cancelled. Your plan runs${until}.`
        : "This plan has ended. You are on the free plan.";
    case "incomplete":
      return "Checkout was started but not finished. Nothing has been charged.";
    case "paused":
      return "This plan is paused.";
    default:
      return `Subscription status: ${status}.`;
  }
}
