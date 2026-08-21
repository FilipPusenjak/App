import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getCounselorAccount } from "@/lib/counselor/access";

/**
 * Where a signed-in account belongs — decided in ONE place.
 *
 * There are two products here and one front door. Login, signup and the
 * marketing page all send people through this route rather than each deciding
 * for themselves, because three copies of "is this a counselor?" is three
 * chances for one of them to be wrong after the next change.
 *
 * It renders nothing. A redirect is the whole job.
 */
export default async function StartPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // A counselor account lands on their caseload. Note this does NOT gate
  // /dashboard: an account can hold both a caseload and their own student
  // profiles — a tutor with a child of their own — and locking them out of one
  // surface because they signed up through the other would be a trap.
  const counselor = await getCounselorAccount();
  redirect(counselor ? "/caseload" : "/dashboard");
}
