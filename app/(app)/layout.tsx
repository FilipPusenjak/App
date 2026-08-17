import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOwnedProfiles } from "@/lib/ownership";
import { logoutAction } from "@/app/actions/auth";
import { shouldShowStudents } from "@/lib/students";
import { StudentSwitcher } from "./student-switcher";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/profile", label: "Profile" },
  { href: "/targets", label: "Targets" },
  { href: "/plans", label: "Plans" },
  { href: "/evaluations", label: "Evaluations" },
  { href: "/students", label: "Students", studentsOnly: true },
  { href: "/settings", label: "Settings" },
];

// Guard for every route in the (app) group. If there's no session we redirect
// to /login before rendering anything, so protected pages never leak.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Most accounts are one student reading their own profile, and a roster of
  // one is a concept they should never have to hold. The page itself stays
  // reachable — this hides the tab, it does not gate the route, and nothing
  // here is an access control (every query is scoped by userId regardless).
  const showStudents = shouldShowStudents({
    managesStudents: user.managesStudents,
    profileCount: (await getOwnedProfiles()).length,
  });
  const nav = NAV.filter((item) => !item.studentsOnly || showStudents);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* Sits on the raised surface rather than the tinted page, so the nav
          reads as a bar instead of dissolving into the background. */}
      <header className="border-b border-black/10 bg-surface dark:border-white/15">
        <div className="mx-auto w-full max-w-4xl px-4 py-3 sm:px-6">
          {/* ── Phone ────────────────────────────────────────────────────────
              Seven links, a student switcher and a log-out button wrapped onto
              four lines and ate a fifth of the screen before any content.
              They collapse behind a disclosure instead.

              <details> rather than a client component: this is the app's
              outermost shell, and making it interactive would ship JavaScript
              and a hydration boundary to every page for a menu the browser can
              open by itself. It also then works before hydration, and closes on
              navigation because the page re-renders. */}
          <details className="group sm:hidden">
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

            <nav className="mt-3 flex flex-col border-t border-black/10 pt-2 dark:border-white/15">
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
                  {user.email}
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

          {/* The student switcher stays OUT of the menu on phones: which
              student you are editing is context, not navigation, and hiding it
              behind a tap is how a counselor edits the wrong child's profile.
              Renders nothing at all until there is a second student. */}
          <div className="mt-3 sm:hidden">
            <StudentSwitcher />
          </div>

          {/* ── Tablet and up ───────────────────────────────────────────── */}
          <div className="hidden flex-wrap items-center justify-between gap-x-5 gap-y-2 sm:flex">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1">
              <Link
                href="/dashboard"
                className="whitespace-nowrap text-sm font-semibold"
              >
                Application Profile Evaluator
              </Link>
              <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
              <StudentSwitcher />
              <span className="hidden text-sm text-zinc-500 lg:inline">
                {user.email}
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
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
