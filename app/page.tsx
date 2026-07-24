import Link from "next/link";
import { getCurrentUser } from "@/lib/session";

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Application Profile Evaluator
        </h1>
        <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Build a private profile of your grades, tests, and resume items, set
          your target universities and career goal, and get honest, calibrated
          AI feedback — with separate rubrics for US (holistic) and UK
          (course-specific) admissions.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          {user ? (
            <Link
              href="/dashboard"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Go to your dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/signup"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Get started
              </Link>
              <Link
                href="/login"
                className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
