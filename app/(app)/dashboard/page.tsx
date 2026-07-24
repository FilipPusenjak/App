import { getCurrentUser } from "@/lib/session";

export default async function DashboardPage() {
  // The (app) layout already guarantees a session; this is just to greet them.
  const user = await getCurrentUser();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Welcome{user?.name ? `, ${user.name}` : ""}.
      </h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        You&apos;re signed in. This is your private dashboard.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="/profile"
          className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Build your profile
        </a>
        <a
          href="/targets"
          className="inline-flex items-center rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Set your targets
        </a>
      </div>

      <div className="mt-6 rounded-lg border border-black/10 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
        Add your grades, test scores, and resume items on the Profile page, and
        the universities you&apos;re aiming at under Targets. Next up (Milestone
        5): AI evaluation of your profile against those targets.
      </div>
    </div>
  );
}
