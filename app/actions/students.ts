"use server";

// Managing the students an account already holds.
//
// Closed to new signups. This used to be an opt-in "I manage more than one
// student" checkbox, open to any account; it is now legacy-data management
// only, for the accounts that already had several profiles before the real
// Counselor Edition (lib/counselor) replaced it with dual consent and a
// revocable grant. There is deliberately no addStudentAction any more — an
// account cannot become multi-student going forward, only stay that way if it
// already was. The privacy rule is unchanged and load-bearing regardless:
// every action here resolves the target through requireOwnedProfile, which
// filters by the SESSION's user id. A profile id arriving from a form is
// treated as a claim to be checked, never as an instruction to be followed.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import {
  getOrCreateProfile,
  getOwnedProfiles,
  requireOwnedProfile,
} from "@/lib/ownership";

export type StudentResult = {
  ok?: boolean;
  message?: string;
  error?: string;
};

const nameSchema = z
  .string()
  .trim()
  .min(1, { error: "Give the student a name." })
  .max(120, { error: "That name is too long." });

const idSchema = z.string().trim().min(1);

/** Switch which student the account is working on. */
export async function switchStudentAction(fd: FormData): Promise<void> {
  const parsed = idSchema.safeParse(String(fd.get("profileId") ?? ""));
  if (!parsed.success) return;

  // Ownership check BEFORE the id is written anywhere. Resolving it later
  // would also be safe — getOrCreateProfile looks the active id up among the
  // account's own profiles — but storing an id we never verified would leave a
  // value in the database that means nothing, and invite someone to trust it.
  const userId = await requireUserId();
  const profile = await requireOwnedProfile(parsed.data);

  await prisma.user.update({
    where: { id: userId },
    data: { activeProfileId: profile.id },
  });

  revalidatePath("/", "layout");
}

/** Rename a student. */
export async function renameStudentAction(
  _prev: StudentResult,
  fd: FormData,
): Promise<StudentResult> {
  const id = idSchema.safeParse(String(fd.get("profileId") ?? ""));
  const name = nameSchema.safeParse(String(fd.get("studentName") ?? ""));
  if (!id.success) return { error: "Student not found." };
  if (!name.success) {
    return { error: name.error.issues[0]?.message ?? "Invalid name." };
  }

  const profile = await requireOwnedProfile(id.data);
  await prisma.profile.update({
    where: { id: profile.id },
    data: { studentName: name.data },
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Renamed." };
}

/**
 * Delete a student and everything belonging to them.
 *
 * Irreversible and unhedged: the profile cascades to resume items, test
 * scores, targets, plans, evaluations and projections. Refused when it is the
 * only student, because an account with no students is a broken state to be in
 * by accident — deleting the account itself is a separate, clearly labelled
 * action in Settings.
 */
export async function deleteStudentAction(
  _prev: StudentResult,
  fd: FormData,
): Promise<StudentResult> {
  const id = idSchema.safeParse(String(fd.get("profileId") ?? ""));
  if (!id.success) return { error: "Student not found." };

  const profiles = await getOwnedProfiles();
  if (profiles.length <= 1) {
    return {
      error:
        "This is the only student on the account. Delete the whole account instead, from Settings.",
    };
  }

  const profile = await requireOwnedProfile(id.data);
  await prisma.profile.delete({ where: { id: profile.id } });

  // If the deleted student was the active one, point the account at another
  // rather than leaving a dangling id. Resolution would survive it either way,
  // but a stored id that refers to nothing is a trap for the next reader.
  const userId = await requireUserId();
  const remaining = profiles.filter((p) => p.id !== profile.id);
  await prisma.user.update({
    where: { id: userId },
    data: { activeProfileId: remaining[0]?.id ?? null },
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Student deleted." };
}

/** The students page's data, in one call. */
export async function getStudentsOverview() {
  const [profiles, active] = await Promise.all([
    getOwnedProfiles(),
    getOrCreateProfile(),
  ]);
  return { profiles, activeId: active.id };
}
