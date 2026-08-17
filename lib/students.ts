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

/**
 * Should this account be offered the Students tab?
 *
 * The account holder opts in (`managesStudents`), because most accounts are one
 * student looking at their own profile and a roster of one is a concept they
 * should never have to hold.
 *
 * THE `OR` IS THE POINT. An account that already has several students keeps the
 * tab whether or not the setting is on, because the setting is presentation and
 * the students are data. Without that, switching it off would strand every
 * profile but the active one behind a page nothing links to — the profiles
 * would still exist, still be owned, and be unreachable. A setting must never
 * be able to hide someone's own records.
 */
export function shouldShowStudents(input: {
  managesStudents: boolean;
  profileCount: number;
}): boolean {
  return input.managesStudents || input.profileCount > 1;
}
