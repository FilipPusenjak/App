import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOwnedProfiles, isCounselorWithoutOwnStudent } from "@/lib/ownership";
import { logoutAction } from "@/app/actions/auth";
import { isMultiStudent } from "@/lib/students";
import { StudentSwitcher } from "./student-switcher";
import { MobileNav } from "./mobile-nav";

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

  // A caseload account with no student of its own does not belong here, and
  // must not be given one for showing up. Everything below — starting with the
  // StudentSwitcher — resolves a profile, and resolving one used to CREATE one,
  // so a counselor who opened /dashboard once acquired a student identity on
  // their email without asking for it or being told.
  //
  // Only the empty case redirects. A counselor who genuinely keeps their own
  // student profile still uses this app for it, and bouncing them would strand
  // that data behind a page nothing links to.
  if (await isCounselorWithoutOwnStudent()) redirect("/caseload");

  // There is no opt-in any more — a new account can never become
  // multi-student. This only stays true for an account that already holds
  // more than one profile from before that was the case; hiding the tab from
  // them would strand every profile but the active one behind a page nothing
  // links to, and a display setting must never be able to do that. The route
  // itself is gated the same way — see app/(app)/students/page.tsx.
  const showStudents = isMultiStudent(await getOwnedProfiles());
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
              They collapse behind a disclosure instead — see mobile-nav.tsx for
              why that disclosure is its own small client component. */}
          <MobileNav nav={nav} userEmail={user.email} />

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
