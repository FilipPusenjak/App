import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getOrCreateProfile, getOwnedProfiles } from "@/lib/ownership";
import { studentLabel } from "@/lib/students";

export default async function DashboardPage() {
  // The (app) layout already guarantees a session; this is just to greet them.
  const [user, profiles, active] = await Promise.all([
    getCurrentUser(),
    getOwnedProfiles(),
    getOrCreateProfile(),
  ]);
  const multiStudent = profiles.length > 1;

  return (
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
            {studentLabel(active)}
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

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/profile"
          className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Build your profile
        </Link>
        <Link
          href="/targets"
          className="inline-flex items-center rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Set your targets
        </Link>
        <Link
          href="/evaluations"
          className="inline-flex items-center rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Evaluate my profile
        </Link>
      </div>

      <div className="mt-6 rounded-lg border border-black/10 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
        Build your profile, add the universities you&apos;re aiming at, then run
        an evaluation for an honest read on how your profile fits each one —
        judged by that country&apos;s admissions rubric.
      </div>
    </div>
  );
}
