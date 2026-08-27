"use client";

import { useRef } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";

/**
 * The phone nav disclosure. A native <details> so it opens before hydration
 * with no JS shipped for that — but a Link's client-side navigation never
 * remounts this layout, so nothing resets <details>'s own open state on route
 * change. This closes it manually on any click inside, which is the one bit
 * that actually needs a script.
 */
export function MobileNav({
  nav,
  userEmail,
}: {
  nav: { href: string; label: string }[];
  userEmail: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  return (
    <details ref={detailsRef} className="group sm:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <Link
          href="/dashboard"
          className="min-w-0 truncate text-sm font-semibold"
        >
          Application Profile Evaluator
        </Link>
        <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-black/15 px-2.5 py-1.5 text-sm font-medium dark:border-white/20">
          Menu
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="h-4 w-4 transition-transform group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 8l5 5 5-5" />
          </svg>
        </span>
      </summary>

      <nav
        className="mt-3 flex flex-col border-t border-black/10 pt-2 dark:border-white/15"
        onClick={() => {
          if (detailsRef.current) detailsRef.current.open = false;
        }}
      >
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            // Generous hit targets: these are the primary navigation on a
            // touch screen, where a 14px text link is not a target.
            className="rounded-md px-2 py-2.5 text-sm text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
          >
            {item.label}
          </Link>
        ))}
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-black/10 pt-3 dark:border-white/15">
          <span className="min-w-0 truncate text-sm text-zinc-500">
            {userEmail}
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Log out
            </button>
          </form>
        </div>
      </nav>
    </details>
  );
}
