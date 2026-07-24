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

      <div className="mt-6 rounded-lg border border-black/10 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
        Next up (Milestone 3): building your profile — grades, test scores, and
        resume items — right here.
      </div>
    </div>
  );
}
