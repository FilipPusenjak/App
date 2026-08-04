import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { logoutAction } from "@/app/actions/auth";

// Guard for every route in the (app) group. If there's no session we redirect
// to /login before rendering anything, so protected pages never leak.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* Sits on the raised surface rather than the tinted page, so the nav
          reads as a bar instead of dissolving into the background. */}
      <header className="border-b border-black/10 bg-surface dark:border-white/15">
        {/* Wraps rather than overflowing: the nav alone is wider than a phone
            screen, so on narrow viewports the brand and links stack onto
            further lines instead of pushing the page sideways. */}
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1">
            <Link href="/dashboard" className="text-sm font-semibold">
              Application Profile Evaluator
            </Link>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
              <Link href="/dashboard" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Dashboard
              </Link>
              <Link href="/profile" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Profile
              </Link>
              <Link href="/targets" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Targets
              </Link>
              <Link href="/plans" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Plans
              </Link>
              <Link href="/evaluations" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Evaluations
              </Link>
              <Link href="/settings" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="hidden text-sm text-zinc-500 sm:inline">
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
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
