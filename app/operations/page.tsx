import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { formatUsd } from "@/lib/cost";
import { RUN_BUDGET_USD } from "@/lib/cost-budget";
import {
  LIST_PRICE_PER_LINK_USD,
  isOperator,
  loadCaseloadCosts,
  monthWindow,
  worstCasePerLinkUsd,
} from "@/lib/counselor/economics";
import { MintCodeForm } from "./mint-code-form";
import { prisma } from "@/lib/db";
import { resolveContentReportAction } from "@/app/actions/content-report";
import {
  REPORT_KIND_LABELS,
  REPORT_REASON_LABELS,
  type ReportKind,
  type ReportReason,
} from "@/lib/content-report";

/**
 * Does the per-link price cover what a caseload actually costs to run?
 *
 * The one screen in this product where several counselors' activity is visible
 * at once, and it exists to answer a pricing question rather than a performance
 * one. It carries no student data of any kind — no names, no profiles, no
 * signals — because a cost report has no business holding any, and an operator
 * is not a party to any consent grant. The content-report queue keeps to that:
 * it shows what a reporter wrote and the ids to look up, never the content.
 *
 * notFound() rather than a 403 for a non-operator: an internal screen should not
 * confirm its own existence to someone who may not read it.
 */
export default async function OperationsPage() {
  const user = await getCurrentUser();
  if (!isOperator(user?.email)) notFound();

  const now = new Date();
  const { from } = monthWindow(now);
  const [rows, reports, resolvedCount] = await Promise.all([
    loadCaseloadCosts(now),
    prisma.contentReport.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.contentReport.count({ where: { resolvedAt: { not: null } } }),
  ]);

  const totals = rows.reduce(
    (acc, r) => ({
      links: acc.links + r.activeLinks,
      spend: acc.spend + r.modelSpendUsd,
      preps: acc.preps + r.prepsGenerated,
      failed: acc.failed + r.prepsFailed,
    }),
    { links: 0, spend: 0, preps: 0, failed: 0 },
  );
  const blendedPerLink = totals.links > 0 ? totals.spend / totals.links : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Cost per caseload
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500">
        {from.toLocaleDateString("en-US", { month: "long", year: "numeric" })},
        so far. Priced against ${LIST_PRICE_PER_LINK_USD.toFixed(2)} per active
        link per month. No student data appears on this page.
      </p>

      {/* The three numbers the pricing rests on, stated before any per-account
          row, because the per-account rows are only interesting relative to
          them. */}
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Blended cost per link"
          value={blendedPerLink === null ? "—" : (formatUsd(blendedPerLink) ?? "—")}
          note={`Against $${LIST_PRICE_PER_LINK_USD.toFixed(2)} charged.`}
        />
        <Stat
          label="Worst case per link"
          value={formatUsd(worstCasePerLinkUsd()) ?? "—"}
          note={`Four preps at the $${RUN_BUDGET_USD.SESSION_PREP.toFixed(2)} ceiling. The number pricing has to survive.`}
        />
        <Stat
          label="Preps this month"
          value={String(totals.preps)}
          note={
            totals.failed > 0
              ? `${totals.failed} spent tokens and produced nothing usable.`
              : "None failed."
          }
        />
      </section>

      <section className="mt-8 overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/15 dark:bg-white/5">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Active links</th>
              <th className="px-4 py-3 font-medium">Preps</th>
              <th className="px-4 py-3 font-medium">Model spend</th>
              <th className="px-4 py-3 font-medium">Per link</th>
              <th className="px-4 py-3 font-medium">Gross margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-zinc-500">
                  No counselor accounts yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.counselorAccountId}
                className="border-b border-black/5 last:border-0 dark:border-white/5"
              >
                <td className="px-4 py-3">
                  {r.orgName ?? (
                    <span className="font-mono text-xs text-zinc-500">
                      {r.counselorAccountId.slice(0, 8)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.activeLinks}
                  <span className="text-zinc-400"> / {r.caseloadLimit}</span>
                  {r.overLimit && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                      over — prep paused
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.prepsGenerated}
                  {r.prepsFailed > 0 && (
                    <span className="text-zinc-400"> ({r.prepsFailed} failed)</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatUsd(r.modelSpendUsd) ?? "—"}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.costPerActiveLinkUsd === null
                    ? "—"
                    : (formatUsd(r.costPerActiveLinkUsd) ?? "—")}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.grossMarginPct === null
                    ? "—"
                    : `${r.grossMarginPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Said explicitly because the table invites the opposite reading. A high
          per-link cost is a fact about how much triage is trusted, not a fact
          about how well anybody works. */}
      <p className="mt-4 max-w-2xl text-xs text-zinc-500">
        A high cost per link means prep is being generated for students triage
        did not surface. Read that as a signal about triage quality before
        reading it as a signal about anything else — and never as a comparison
        between accounts, which this table is not built to support.
      </p>

      <section className="mt-10 rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <h2 className="text-lg font-semibold tracking-tight">Access codes</h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Hand a code to a tester to give their account a run — one Deep
          Review, projection or check-in — or, for the short allowlist in
          GRANTABLE_PLAN_CODES, a real subscription that lapses on its own
          after 30 days. Never a discount, never a recurring charge — see
          lib/billing/codes.ts.
        </p>
        <div className="mt-4">
          <MintCodeForm />
        </div>
      </section>

      {/* Reports of AI-generated content, from the "Report this" control under
          every evaluation, projection, prep and briefing. Shows what the
          REPORTER wrote and where to look, not the content itself — the page
          stays free of student data, and the ids are enough to find the row. */}
      <section className="mt-10 rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <h2 className="text-lg font-semibold">Reported AI content</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {reports.length === 0
            ? "Nothing open."
            : `${reports.length} open, oldest first.`}{" "}
          {resolvedCount > 0 && `${resolvedCount} resolved.`}
        </p>
        {reports.length > 0 && (
          <ul className="mt-4 space-y-3 text-sm">
            {reports.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-black/10 p-3 dark:border-white/10"
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">
                    {REPORT_KIND_LABELS[r.kind as ReportKind] ?? r.kind}
                  </span>
                  <span className="text-zinc-500">
                    {REPORT_REASON_LABELS[r.reason as ReportReason] ?? r.reason}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {r.createdAt.toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                {r.details && (
                  <p className="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                    {r.details}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
                  <span>
                    target <code className="font-mono">{r.targetId}</code>
                  </span>
                  <span>
                    reporter <code className="font-mono">{r.reporterUserId}</code>
                  </span>
                  <form action={resolveContentReportAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-black/15 px-2 py-1 font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      Mark resolved
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{note}</p>
    </div>
  );
}
