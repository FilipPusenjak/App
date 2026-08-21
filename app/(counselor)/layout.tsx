import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { logoutAction } from "@/app/actions/auth";
import { getCounselorAccount } from "@/lib/counselor/access";

/**
 * Its own route group, its own layout, its own navigation.
 *
 * NOT the student app with a mode switch. There is deliberately no link from
 * here into /dashboard or /profile, and no student switcher: this surface
 * answers "who needs me this week" and the student app answers "what should I
 * do next", and a counselor who can slide between the two is a counselor
 * looking at one child's data while working on another's.
 */
const NAV = [
  { href: "/caseload", label: "This week" },
  { href: "/caseload/students", label: "Students" },
];

export default async function CounselorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // A counselor account or nothing. An ordinary account reaching this URL is
  // sent back to their own dashboard rather than shown an empty caseload —
  // there is nothing here for them, and an empty professional tool looks broken
  // rather than inapplicable.
  const account = await getCounselorAccount();
  if (!account) redirect("/dashboard");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-black/10 bg-surface dark:border-white/15">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight">
              {account.orgName ?? "Caseload"}
            </span>
            <nav className="flex gap-4">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-zinc-600 transition-colors hover:text-foreground dark:text-zinc-400"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-sm text-zinc-500 transition-colors hover:text-foreground"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
