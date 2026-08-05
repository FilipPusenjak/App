import Link from "next/link";
import {
  getOwnedPlannedItems,
  getOwnedProjections,
  getProfileWithRelations,
} from "@/lib/ownership";
import {
  RESUME_ITEM_TYPE_LABELS,
  type ResumeItemType,
} from "@/lib/validation/enums";
import { deletePlanAction, markPlanDoneAction } from "@/app/actions/plan";
import { SubmitButton } from "@/components/ui/submit-button";
import { RunProjectionButton } from "./run-projection-button";

function monthYear(d: Date | null) {
  if (!d) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function PlansPage() {
  const [profile, plans, projections] = await Promise.all([
    getProfileWithRelations(),
    getOwnedPlannedItems(),
    getOwnedProjections(),
  ]);

  const noPlans = plans.length === 0;
  const noTargets = profile.targetSchools.length === 0;
  const disabledReason = noPlans
    ? "Add something you're planning to do first."
    : noTargets
      ? "Add a target school first — what a plan is worth depends on where you're applying."
      : undefined;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Things you&apos;re considering doing. A projection tells you what
            they&apos;d be worth — and which ones wouldn&apos;t move anything.
          </p>
        </div>
        <RunProjectionButton
          disabled={Boolean(disabledReason)}
          disabledReason={disabledReason}
        />
      </div>

      {/* The whole point of keeping plans separate, stated where it matters. */}
      <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        {/* Explicit space: a plain one written after </strong> is swallowed by
            the JSX transform, and the sentence renders as "scores.Nothing". */}
        <strong>Plans don&apos;t count toward your scores.</strong>{" "}
        Nothing here touches your evaluations or your progress chart — that
        history stays a record of what you&apos;ve actually done. When you
        finish something, mark it done and it becomes a real resume item.
      </p>

      <Card
        title="What you're planning"
        subtitle="Be concrete about what you'd actually produce — a vague plan gets a vague projection."
      >
        <div className="mb-4">
          <Link
            href="/plans/new"
            className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Add a plan
          </Link>
        </div>

        {plans.length > 0 ? (
          <ul className="space-y-3">
            {plans.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-black/10 p-4 dark:border-white/15"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <span className="inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                      {RESUME_ITEM_TYPE_LABELS[p.type as ResumeItemType] ??
                        p.type}
                    </span>
                    <h3 className="mt-1 font-medium">{p.title}</h3>
                    <p className="text-sm text-zinc-500">
                      {[
                        p.org,
                        p.targetDate ? `by ${monthYear(p.targetDate)}` : null,
                        p.hoursPerWeek ? `${p.hoursPerWeek} hrs/wk` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {p.description && (
                      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <form action={markPlanDoneAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton pendingText="…">
                        I&apos;ve done this
                      </SubmitButton>
                    </form>
                    <Link
                      href={`/plans/${p.id}`}
                      className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      Edit
                    </Link>
                    <form action={deletePlanAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton variant="danger" pendingText="…">
                        Delete
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">
            Nothing planned yet. Add the things you&apos;re thinking about doing
            and run a projection to see which are worth the effort.
          </p>
        )}
      </Card>

      {projections.length > 0 && (
        <Card
          title="Past projections"
          subtitle="Each one is a snapshot of the plans as they were at the time."
        >
          <ul className="space-y-3">
            {projections.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-black/10 p-4 dark:border-white/15"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                        {p.status === "pending" ? "Running…" : p.status}
                      </span>
                      {p.isSample && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                          Sample — not AI output
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {p.createdAt.toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {p.model ? ` · ${p.model}` : ""}
                    </p>
                    {p.error && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {p.error}
                      </p>
                    )}
                  </div>
                  {p.status === "completed" && (
                    <Link
                      href={`/projections/${p.id}`}
                      className="shrink-0 self-start rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    >
                      View
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
