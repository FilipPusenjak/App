"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import {
  getOrCreateProfile,
  requireOwnedResumeItem,
  requireOwnedTestScore,
} from "@/lib/ownership";
import {
  profileSchema,
  resumeItemSchema,
  testScoreSchema,
} from "@/lib/validation/profile";

export type FormResult =
  | {
      ok?: boolean;
      message?: string;
      error?: string;
      fieldErrors?: Record<string, string>;
    }
  | undefined;

// --- FormData readers -------------------------------------------------------

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optText(fd: FormData, key: string): string | undefined {
  const v = text(fd, key);
  return v === "" ? undefined : v;
}
function optNumber(fd: FormData, key: string): number | undefined {
  const v = text(fd, key);
  if (v === "") return undefined;
  return Number(v); // NaN is rejected by z.number()
}
function optDate(fd: FormData, key: string): Date | undefined {
  const v = text(fd, key);
  return v === "" ? undefined : new Date(v);
}

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}

// --- Profile ---------------------------------------------------------------

export async function updateProfileAction(
  _prev: FormResult,
  fd: FormData,
): Promise<FormResult> {
  const parsed = profileSchema.safeParse({
    gradeLevel: optText(fd, "gradeLevel"),
    schoolName: optText(fd, "schoolName"),
    schoolContext: optText(fd, "schoolContext"),
    curriculum: optText(fd, "curriculum"),
    gpa: optNumber(fd, "gpa"),
    gpaScale: optText(fd, "gpaScale"),
    intendedMajor: optText(fd, "intendedMajor"),
    careerGoal: optText(fd, "careerGoal"),
    countryOfOrigin: text(fd, "countryOfOrigin"),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const userId = await requireUserId();
  const profile = await getOrCreateProfile();
  const d = parsed.data;

  // Profile fields (owned via profile.id, which came from the session).
  await prisma.profile.update({
    where: { id: profile.id },
    data: {
      gradeLevel: d.gradeLevel ?? null,
      schoolName: d.schoolName ?? null,
      schoolContext: d.schoolContext ?? null,
      curriculum: d.curriculum ?? null,
      gpa: d.gpa ?? null,
      gpaScale: d.gpaScale ?? null,
      intendedMajor: d.intendedMajor ?? null,
      careerGoal: d.careerGoal ?? null,
    },
  });
  // countryOfOrigin lives on the User.
  await prisma.user.update({
    where: { id: userId },
    data: { countryOfOrigin: d.countryOfOrigin ? d.countryOfOrigin : null },
  });

  revalidatePath("/profile");
  return { ok: true, message: "Profile saved." };
}

// --- Test scores -----------------------------------------------------------

export async function addTestScoreAction(
  _prev: FormResult,
  fd: FormData,
): Promise<FormResult> {
  const parsed = testScoreSchema.safeParse({
    kind: text(fd, "kind"),
    label: text(fd, "label"),
    score: text(fd, "score"),
    maxScore: optText(fd, "maxScore"),
    predicted: fd.get("predicted") != null,
    takenOn: optDate(fd, "takenOn"),
  });
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const profile = await getOrCreateProfile();
  const d = parsed.data;
  await prisma.testScore.create({
    data: {
      profileId: profile.id,
      kind: d.kind,
      label: d.label,
      score: d.score,
      maxScore: d.maxScore ?? null,
      predicted: d.predicted ?? false,
      takenOn: d.takenOn ?? null,
    },
  });

  revalidatePath("/profile");
  return { ok: true, message: "Score added." };
}

export async function deleteTestScoreAction(fd: FormData): Promise<void> {
  const id = text(fd, "id");
  await requireOwnedTestScore(id); // throws if not owned
  await prisma.testScore.delete({ where: { id } });
  revalidatePath("/profile");
}

// --- Resume items ----------------------------------------------------------

function parseResumeItem(fd: FormData) {
  return resumeItemSchema.safeParse({
    type: text(fd, "type"),
    title: text(fd, "title"),
    description: optText(fd, "description"),
    org: optText(fd, "org"),
    startDate: optDate(fd, "startDate"),
    endDate: optDate(fd, "endDate"),
    hoursPerWeek: optNumber(fd, "hoursPerWeek"),
    evidenceNotes: optText(fd, "evidenceNotes"),
  });
}

export async function createResumeItemAction(
  _prev: FormResult,
  fd: FormData,
): Promise<FormResult> {
  const parsed = parseResumeItem(fd);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const profile = await getOrCreateProfile();
  const d = parsed.data;
  await prisma.resumeItem.create({
    data: {
      profileId: profile.id,
      type: d.type,
      title: d.title,
      description: d.description ?? null,
      org: d.org ?? null,
      startDate: d.startDate ?? null,
      endDate: d.endDate ?? null,
      hoursPerWeek: d.hoursPerWeek ?? null,
      evidenceNotes: d.evidenceNotes ?? null,
    },
  });

  revalidatePath("/profile");
  redirect("/profile");
}

export async function updateResumeItemAction(
  id: string,
  _prev: FormResult,
  fd: FormData,
): Promise<FormResult> {
  await requireOwnedResumeItem(id); // throws if not owned

  const parsed = parseResumeItem(fd);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const d = parsed.data;
  await prisma.resumeItem.update({
    where: { id },
    data: {
      type: d.type,
      title: d.title,
      description: d.description ?? null,
      org: d.org ?? null,
      startDate: d.startDate ?? null,
      endDate: d.endDate ?? null,
      hoursPerWeek: d.hoursPerWeek ?? null,
      evidenceNotes: d.evidenceNotes ?? null,
    },
  });

  revalidatePath("/profile");
  redirect("/profile");
}

export async function deleteResumeItemAction(fd: FormData): Promise<void> {
  const id = text(fd, "id");
  await requireOwnedResumeItem(id); // throws if not owned
  await prisma.resumeItem.delete({ where: { id } });
  revalidatePath("/profile");
}
