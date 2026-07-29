import Link from "next/link";
import { getOrCreateProfile, getOwnedTargets } from "@/lib/ownership";
import { countryName } from "@/lib/data/countries";
import { deleteTargetAction } from "@/app/actions/target";
import { SubmitButton } from "@/components/ui/submit-button";


export default async function TargetsPage() {
  const [profile, targets] = await Promise.all([
    getOrCreateProfile(),
    getOwnedTargets(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Targets & goals</h1>
        <p className="mt-1 text-sm text-zinc-500">
          The universities you&apos;re aiming at, plus your intended direction.
        </p>
      </div>

      {/* Goals (edited on the profile page) */}
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-zinc-500">Intended major:</span>{" "}
              <span className="font-medium">
                {profile.intendedMajor || "Not set"}
              </span>
            </p>
            <p>
              <span className="text-zinc-500">Career goal:</span>{" "}
              <span className="font-medium">
                {profile.careerGoal || "Not set"}
              </span>
            </p>
          </div>
          <Link
            href="/profile"
            className="shrink-0 rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Edit on profile
          </Link>
        </div>
      </section>

      {/* Target schools */}
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Target schools</h2>
            <p className="text-sm text-zinc-500">
              Add the country and the specific course. Whether each one is a
              reach, match, or safety is decided by the evaluation from your
              actual profile — not something you tag yourself.
            </p>
          </div>
          <Link
            href="/targets/new"
            className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Add target
          </Link>
        </div>

        {targets.length > 0 ? (
          <ul className="space-y-3">
            {targets.map((t) => {
              return (
                <li
                  key={t.id}
                  className="rounded-lg border border-black/10 p-4 dark:border-white/15"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{t.name}</h3>
                        {t.priority != null && (
                          <span className="text-xs text-zinc-400">
                            priority {t.priority}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-zinc-500">
                        {[countryName(t.country), t.course]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {t.notes && (
                        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                          {t.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/targets/${t.id}`}
                        className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Edit
                      </Link>
                      <form action={deleteTargetAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <SubmitButton variant="danger" pendingText="…">
                          Delete
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">
            No target schools yet. Click “Add target” to add the universities
            you&apos;re considering.
          </p>
        )}
      </section>
    </div>
  );
}
