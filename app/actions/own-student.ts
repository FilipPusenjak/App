"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOwnStudentProfile } from "@/lib/ownership";
import { getCounselorAccount } from "@/lib/counselor/access";

/**
 * A counselor asking for their own student profile.
 *
 * This exists because the app stopped handing them one for navigating to
 * /dashboard. Auto-creation was the ONLY way a profile was ever made
 * (lib/ownership.ts), so removing it silently would have taken the supported
 * "tutor with a child of their own" case with it. Now the same row is created,
 * by the same code, with the one difference that matters: somebody chose it.
 *
 * Nothing here is a privilege escalation in either direction. A student profile
 * is the account's own data, holds no caseload, and grants no access to anybody
 * else's student — the caseload's dual-consent grants are a wholly separate
 * mechanism and are untouched.
 */
export async function createOwnStudentProfileAction(): Promise<void> {
  // Only from a caseload account. An ordinary account already has a profile and
  // has no use for this, and gating it keeps the action from becoming a second,
  // unguarded way to make profiles.
  const counselor = await getCounselorAccount();
  if (!counselor) redirect("/dashboard");

  await createOwnStudentProfile();

  // The layout's redirect keyed on having none, so both surfaces change.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
