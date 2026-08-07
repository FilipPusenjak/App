import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  getOwnedEvaluations,
  getOwnedPlannedItems,
  getOwnedProjections,
  getProfileWithRelations,
} from "@/lib/ownership";
import { getAiStatus } from "@/lib/ai-status";
import { DeleteAccountForm } from "./delete-account-form";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user?.email) redirect("/login");

  const [profile, evaluations, plannedItems, projections] = await Promise.all([
    getProfileWithRelations(),
    getOwnedEvaluations(),
    getOwnedPlannedItems(),
    getOwnedProjections(),
  ]);

  const ai = getAiStatus();

  const counts = [
    { label: "resume items", n: profile.resumeItems.length },
    { label: "test scores", n: profile.testScores.length },
    { label: "target schools", n: profile.targetSchools.length },
    { label: "evaluations", n: evaluations.length },
    { label: "plans", n: plannedItems.length },
    { label: "projections", n: projections.length },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Account & data
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Signed in as {user.email}.
        </p>
      </div>

      {/* Whether this deployment can actually reach the model.
          Without this the only way to find out was to spend an evaluation and
          read the result: a red 401 meant the key was present and wrong, a
          sample banner meant it was missing entirely, and those need opposite
          fixes. Never shows the key, or any part of it. */}
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <h2 className="text-lg font-semibold">AI evaluations</h2>
        {ai.live ? (
          <>
            <p className="mt-0.5 text-sm text-zinc-500">
              Connected. Evaluations call the model and return a real
              assessment.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <li>
                First evaluation of a student:{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {ai.baselineModel}
                </span>
              </li>
              <li>
                Later, anchored runs:{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {ai.followupModel ?? ai.baselineModel}
                </span>
              </li>
            </ul>
          </>
        ) : (
          <>
            <p className="mt-0.5 text-sm text-zinc-500">
              Not connected — every evaluation returns clearly-labelled sample
              output instead of a real assessment.
            </p>
            <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              No <code>ANTHROPIC_API_KEY</code> is set for this deployment. If
              you believe you have set one, the name has to match exactly and it
              has to be enabled for the environment you are looking at — and the
              app only picks up a change on the next deploy, not immediately.
              An <em>invalid</em> key looks different from this: runs fail with
              a 401 rather than falling back to samples.
            </p>
          </>
        )}
      </section>

      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <h2 className="text-lg font-semibold">Your data</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Everything stored under this account, private to you.
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          {counts.map((c) => (
            <li key={c.label}>
              <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                {c.n}
              </span>{" "}
              {c.label}
            </li>
          ))}
        </ul>

        <div className="mt-4">
          {/* A plain link, not fetch(): the browser handles the download and the
              file never has to pass through client-side JavaScript. */}
          <a
            href="/api/export"
            className="inline-flex items-center rounded-md border border-black/15 px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Download my data (JSON)
          </a>
          <p className="mt-2 text-xs text-zinc-400">
            Includes your profile, every resume item, test score, target school,
            and the full text of every evaluation. Your password is not included
            — it is stored only as a hash and is never exported.
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-red-200 bg-red-50/40 p-5 dark:border-red-900/60 dark:bg-red-950/20">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-300">
          Danger zone
        </h2>
        <p className="mb-4 mt-0.5 text-sm text-red-800/80 dark:text-red-300/80">
          Deleting your account removes everything above, permanently.
        </p>
        <DeleteAccountForm email={user.email} />
      </section>
    </div>
  );
}
