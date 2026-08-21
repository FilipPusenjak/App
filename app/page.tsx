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
              href="/start"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Continue
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

        {!user && (
          // Said here rather than left to be discovered on the signup form: a
          // counselor who does not know this product has a caseload side will
          // not click "Get started" to find out.
          <p className="mt-6 text-sm text-zinc-500">
            A counselor or tutor running a caseload?{" "}
            <Link
              href="/signup"
              className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
            >
              Create a counselor account
            </Link>{" "}
            — you see nothing about a student until they invite you and a parent
            or guardian agrees.
          </p>
        )}
      </div>
    </main>
  );
}
