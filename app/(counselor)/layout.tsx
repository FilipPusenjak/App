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
// "This week" stays FIRST and stays the index route. The overview is context
// for the job; the attention list is the job.
const NAV = [
  { href: "/caseload", label: "This week" },
  // Commitments before Advice, and both before the directory. The order is the
  // order of the work: what is about to matter, then what I said about it, then
  // the list of people. A directory is a lookup, not a starting point.
  { href: "/caseload/commitments", label: "Commitments" },
  { href: "/caseload/advice", label: "Advice" },
  { href: "/caseload/overview", label: "Overview" },
  { href: "/caseload/students", label: "Students" },
  // Last, and plainly named. Both refusals in the API — no new student, no new
  // prep — tell a counselor to raise their plan, so there has to be a standing
  // way to reach it rather than only a link inside an error they may have
  // dismissed.
  { href: "/caseload/plan", label: "Plan" },
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
  // The mirror of the check in app/(tutor)/layout.tsx. A tutor reaching this
  // URL is sent to their own surface rather than shown a triage queue that was
  // never theirs: same account table, different product.
  if (account.type === "TEST_PREP_TUTOR") redirect("/students-testprep");

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
