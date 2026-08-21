// Display helpers for students, kept in one place so the same profile is never
// labelled two different ways on two different pages.
import type { Profile } from "@/lib/generated/prisma/client";

/** The fallback for a profile with no name — a solo student's own record. */
export const UNNAMED_STUDENT = "Your profile";

/** What to call a student in the interface. */
export function studentLabel(
  profile: Pick<Profile, "studentName"> | null | undefined,
): string {
  const name = profile?.studentName?.trim();
  return name && name.length > 0 ? name : UNNAMED_STUDENT;
}

/**
 * Whether the account is running more than one student.
 *
 * The switcher, the "which student is this?" labels and the students page are
 * all hidden below this line. Now the ONLY way an account gets here at all —
 * there is no opt-in for a new one to become multi-student any more. A real
 * counselor manages several students through the Counselor Edition
 * (lib/counselor), under dual consent and a revocable grant; this function
 * exists purely so an account that already holds more than one profile from
 * before that existed does not have those profiles become unreachable.
 */
export function isMultiStudent(profiles: unknown[]): boolean {
  return profiles.length > 1;
}
