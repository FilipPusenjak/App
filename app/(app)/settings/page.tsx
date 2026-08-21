import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listGrantsForStudent } from "@/lib/counselor/access";
import {
  getOwnedEvaluations,
  getOwnedPlannedItems,
  getOwnedProjections,
  getProfileWithRelations,
} from "@/lib/ownership";
import { getAiStatus } from "@/lib/ai-status";
import { getDeploymentInfo } from "@/lib/deployment-info";
import { getSpendStatus } from "@/lib/spending-account";
import { getOwnedProfiles } from "@/lib/ownership";
import { formatUsd } from "@/lib/cost";
import { DeleteAccountForm } from "./delete-account-form";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user?.email) redirect("/login");

  const profiles = await getOwnedProfiles();
  const profileCount = profiles.length;
  const multiStudentAlready = profileCount > 1;

  const [profile, evaluations, plannedItems, projections] = await Promise.all([
    getProfileWithRelations(),
    getOwnedEvaluations(),
    getOwnedPlannedItems(),
    getOwnedProjections(),
  ]);

  const ai = getAiStatus();
  const deployment = getDeploymentInfo();
  const spend = await getSpendStatus();

  // Counted as "live" only when the link is ACTIVE and BOTH consents are in —
  // the same condition readableLinkWhere enforces. A pending invite must not
  // read as somebody already looking.
  const grants = await listGrantsForStudent();
  const liveGrants = grants.filter(
    (g) => g.status === "ACTIVE" && g.studentConsentAt && g.guardianConsentAt,
  ).length;

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

            {/* The budget, shown before it bites rather than only when a run
                is refused. The figure is an estimate from recorded token
                counts, not the bill — saying so is the difference between a
                guard rail and a number someone will treat as accounting. */}
            {!spend.unlimited && (
              <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/15">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  AI budget for this account:{" "}
                  <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatUsd(spend.spentUsd) ?? "$0.00"} of{" "}
                    {formatUsd(spend.limitUsd)}
                  </span>{" "}
                  used{spend.allowed ? "" : " — new runs are paused"}.
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  An estimate from recorded token counts, not your Anthropic
                  bill. It covers every student on this account, and counts
                  failed runs, which still spend. Set a hard limit in the
                  Anthropic console as well — that is the one that cannot be
                  exceeded.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-0.5 text-sm text-zinc-500">
              Not connected — every evaluation returns clearly-labelled sample
              output instead of a real assessment.
            </p>
            <div className="mt-3 space-y-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <p>
                No <code>ANTHROPIC_API_KEY</code> is set for this deployment.
                It has to be enabled for the environment you are looking at, and
                the app only picks it up on the next deploy — a failed build
                leaves the previous deployment serving, so nothing changes.
                An <em>invalid</em> key looks different from this: runs fail
                with a 401 rather than falling back to samples.
              </p>
              {ai.expectedNameIsEmpty && (
                <p>
                  <strong className="font-semibold">
                    The variable exists but is empty.
                  </strong>{" "}
                  Something is set under that exact name with no usable value —
                  delete it and add it again, watching the value field as you
                  paste.
                </p>
              )}
              {/* Presence of the other expected variables, as a comparison.
                  One visible and another missing is a per-variable problem;
                  none visible means this build predates all of them and needs
                  rebuilding, not reconfiguring. Names and yes/no only. */}
              <div>
                <p className="font-semibold">
                  What this deployment can see:
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-xs">
                  {ai.configPresence.map((c) => (
                    <li key={c.name}>
                      {c.present ? "present" : "MISSING"} — {c.name}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">
                  If some are present and{" "}
                  <code>ANTHROPIC_API_KEY</code> is not, the variable itself is
                  the problem. If they are all missing, this build is older than
                  the changes and needs redeploying.
                </p>
              </div>
              {ai.nearMissEnvNames.length > 0 && (
                <div>
                  <p>
                    <strong className="font-semibold">
                      Found variables with a similar name:
                    </strong>{" "}
                    these are NOT the one the app reads. A trailing space, or a
                    character copied invisibly from a document, makes a name
                    that looks identical and is a different variable. Quoted
                    here so any stray whitespace is visible:
                  </p>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs">
                    {ai.nearMissEnvNames.map((name) => (
                      <li key={name}>{JSON.stringify(name)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Which build is answering. Without this, "the deployment is X" and
          "this page came from X" are different claims that look the same —
          a stale production alias, a preview URL in another tab, or a cached
          page all serve a build you are not looking at in the dashboard. */}
      {(deployment.commit || deployment.environment) && (
        <p className="text-xs text-zinc-400">
          Serving{" "}
          {deployment.commit && (
            <>
              commit{" "}
              <span className="font-mono text-zinc-500">
                {deployment.commit}
              </span>
            </>
          )}
          {deployment.commit && deployment.environment ? " · " : ""}
          {deployment.environment && (
            <>
              <span className="font-medium text-zinc-500">
                {deployment.environment}
              </span>{" "}
              environment
            </>
          )}
          {deployment.branch ? ` · ${deployment.branch}` : ""}
          {deployment.environment && deployment.environment !== "production"
            ? " — environment variables are scoped per environment, so this may not match production."
            : ""}
        </p>
      )}

      {/* Only shown at all to an account that already holds more than one
          profile from before this closed to new signups — there is nothing
          left to configure, so nothing renders for a solo account. A
          counselor managing several students today uses the Counselor
          Edition, under dual consent and a revocable grant, not this. */}
      {multiStudentAlready && (
        <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
          <h2 className="text-lg font-semibold">Students</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            You have {profileCount} students on this account from before this
            was closed to new signups. The tab stays available so those
            profiles are never stranded.
          </p>
          <div className="mt-3">
            <Link
              href="/students"
              className="inline-flex items-center rounded-md border border-black/15 px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Manage students
            </Link>
          </div>
        </section>
      )}

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

      {/* Always shown, including — especially — when the answer is "nobody".
          A sharing control that only appears once sharing exists cannot be used
          to check whether sharing exists. */}
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <h2 className="text-lg font-semibold">Who can see this</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {liveGrants === 0
            ? "Nobody outside this account. Nothing here is public or shareable by default."
            : `${liveGrants} counselor or tutor ${liveGrants === 1 ? "grant is" : "grants are"} live. You can end any of them instantly.`}
        </p>
        <div className="mt-4">
          <Link
            href="/settings/access"
            className="inline-flex items-center rounded-md border border-black/15 px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Manage access and see what was read
          </Link>
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
