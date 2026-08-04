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
 * all hidden below this line: a solo student should never have to think about
 * a concept that exists for counselors.
 */
export function isMultiStudent(profiles: unknown[]): boolean {
  return profiles.length > 1;
}
