"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * What a student sees when a page throws.
 *
 * Until this existed, the answer was Next's default grey error screen: no
 * branding, no way back, and — to somebody who has just typed their grades and
 * their targets into a form — no indication of whether any of it survived. That
 * last part is the whole reason this file has more than a heading in it.
 *
 * WHAT IT PROMISES, AND WHY THAT PROMISE IS SAFE. It says the data is still
 * there. That is true by construction rather than by optimism: every write in
 * this app is a server action or a route handler that has already committed
 * before anything renders, so a render that throws cannot be a write that half
 * happened. The one thing a student actually fears here is the thing that
 * cannot occur.
 *
 * IT SHOWS THE DIGEST AND NOT THE MESSAGE. In production Next replaces a server
 * error's message with a generic one precisely so nothing sensitive reaches the
 * browser, and the digest is the hash that matches it to the server log. Showing
 * the digest gives somebody reporting a problem something useful to quote;
 * showing error.message would either be that same generic string or, in
 * development, real internals.
 *
 * `retry` RATHER THAN `reset` — see node_modules/next/dist/docs, error.js. reset
 * re-renders the boundary's children without re-fetching, which for a page whose
 * content comes from the database means showing the same failure again. retry
 * re-fetches, which is what "try again" has to mean for it to be worth offering.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Reaches the server logs on Vercel, and the browser console locally. There
    // is no error-reporting service wired up yet; when there is, it goes here.
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight">
          Something went wrong on this page
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Nothing you have saved is affected — your profile, evaluations and
          plans are all still there. This is a problem drawing the page, not a
          problem with your records.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Try again
          </button>
          <Link
            href="/start"
            className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Go back
          </Link>
        </div>

        {/* Only when there is one. An empty "Reference:" line is furniture. */}
        {error.digest && (
          <p className="mt-6 text-xs text-zinc-400">
            If you report this, quote reference{" "}
            <code className="font-mono">{error.digest}</code>.
          </p>
        )}
      </div>
    </main>
  );
}
