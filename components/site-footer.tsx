import Link from "next/link";

/**
 * The one place the legal pages are reachable from.
 *
 * In the ROOT layout rather than per-route-group, because these have to be
 * reachable from the signed-out marketing page, from inside the student app,
 * and from the counselor surface alike — and because a link that exists on
 * only some pages is the one somebody cannot find when they want it.
 *
 * Deliberately spare. It is a legal footer, not a navigation surface: adding
 * product links here would put a route into the counselor layout that its own
 * navigation deliberately excludes (see app/(counselor)/layout.tsx on why there
 * is no path from a caseload into the student app).
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-black/10 dark:border-white/10">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-5 text-xs text-zinc-500 sm:px-6">
        <span>CourseChart</span>
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        {/* Privacy belongs beside Terms and is deliberately NOT linked yet:
            app/privacy does not exist, and a footer link to a 404 is worse
            than an absent one — it reads as a policy that was written and then
            lost. Add the link in the same change that adds the page. */}
      </div>
    </footer>
  );
}
