export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-2xl">
        <span className="inline-block rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-white/15 dark:text-zinc-400">
          Milestone 1 · scaffold
        </span>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          Application Profile Evaluator
        </h1>
        <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Build a private profile of your grades, tests, and resume items, set
          your target universities and career goal, and get honest, calibrated
          AI feedback — with separate rubrics for US (holistic) and UK
          (course-specific) admissions.
        </p>
        <div className="mt-8 rounded-lg border border-black/10 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-white/15 dark:bg-white/5 dark:text-zinc-400">
          Project scaffold, Prisma schema, and seed data are in place. Auth and
          the profile UI arrive in the next milestones.
        </div>
      </div>
    </main>
  );
}
