import Link from "next/link";
import type { LockedPreview as Preview } from "@/lib/documents/preview";

/**
 * What a free account sees: the feature, blurred, built from a student who
 * does not exist. Visible rather than hidden, so nobody has to guess what Plus
 * would give them — and never their own data, which this component is not
 * even given.
 */
export function LockedPreview({
  preview,
  focus,
}: {
  preview: Preview;
  focus?: "common-app" | "brag-sheet" | "resume";
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-white/5">
        <h2 className="text-lg font-semibold">Part of Plus</h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Turn your profile into what applications actually ask for: your Common
          App activities list with every field sized to fit, a brag sheet for
          the people writing your recommendations, and a one-page resume. Built
          only from what you entered. Nothing is ever added.
        </p>
        <Link
          href="/settings/billing"
          className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
        >
          See Plus
        </Link>
        <p className="mt-3 text-xs text-zinc-500">
          The examples below belong to {preview.student}, a sample student. None of it is yours.
        </p>
      </section>

      <div className="relative">
        {/* aria-hidden: the sample is decoration, not content to read out. */}
        <div aria-hidden className="pointer-events-none select-none space-y-4 blur-[3px]">
          {(!focus || focus === "common-app") && (
            <section className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
              <h3 className="font-semibold">Common App activities</h3>
              <ol className="mt-3 space-y-3 text-sm">
                {preview.commonApp.map((a, i) => (
                  <li key={i} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                    <p className="font-medium">{a.organization}</p>
                    <p className="text-xs text-zinc-500">{[a.type, a.position, `grades ${a.grades}`].filter(Boolean).join(" · ")}</p>
                    <p className="mt-1">{a.description}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(!focus || focus === "brag-sheet") && (
            <section className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-white/5">
              <h3 className="font-semibold">Brag sheet</h3>
              {preview.bragSheet.map((s) => (
                <div key={s.title} className="mt-3 text-sm">
                  <p className="font-medium">{s.title}</p>
                  {s.lines.map((l) => <p key={l}>{l}</p>)}
                </div>
              ))}
            </section>
          )}
          {(!focus || focus === "resume") && (
            <section className="rounded-xl border border-black/10 bg-white p-5 font-mono text-xs dark:border-white/15 dark:bg-white/5">
              {preview.resume.map((l) => <p key={l}>{l}</p>)}
            </section>
          )}
        </div>
        <div className="absolute inset-0 flex items-start justify-center pt-16">
          <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white shadow dark:bg-white dark:text-zinc-900">
            🔒 Plus
          </span>
        </div>
      </div>
    </div>
  );
}
