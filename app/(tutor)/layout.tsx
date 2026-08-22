import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { logoutAction } from "@/app/actions/auth";
import { getCounselorAccount } from "@/lib/counselor/access";
import { caseloadStanding } from "@/lib/testprep/entitlement";

/**
 * The test-prep tutor's surface. Its own route group, layout and navigation.
 *
 * NOT the counselor edition with fewer links. There is no "this week" here and
 * there must not be: a counselor's scarce resource is attention across a
 * caseload, so they get triage. A test-prep tutor already knows they are seeing
 * Priya at four on Tuesday. What they cannot answer without help is what they
 * are aiming at and when to stop, which is why this surface leads with students
 * and their targets rather than with a queue.
 */
const NAV = [
  { href: "/students-testprep", label: "Students" },
];

export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const account = await getCounselorAccount();
  if (!account) redirect("/dashboard");
  // A counselor reaching this URL is sent to their own surface rather than
  // shown an empty roster: the two products share an account table and nothing
  // else, and an empty professional tool reads as broken rather than
  // inapplicable.
  if (account.type !== "TEST_PREP_TUTOR") redirect("/caseload");

  const standing = await caseloadStanding(account.id);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-black/10 bg-surface dark:border-white/15">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight">
              {account.orgName ?? "Test prep"}
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

      {/* SOFT ENFORCEMENT, rendered as a notice and nothing else. No modal, no
          interstitial, no disabled buttons. A tutor who finds this mid-session
          with a student and a parent in the room can read it and carry on. */}
      {standing.overBand && standing.message && (
        <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {standing.message}
            </p>
            <Link
              href="/students-testprep/plan"
              className="shrink-0 text-xs font-medium text-amber-900 underline underline-offset-2 dark:text-amber-100"
            >
              See plans
            </Link>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
