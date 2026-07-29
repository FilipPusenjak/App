"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  getOrCreateProfile,
  requireOwnedTargetSchool,
} from "@/lib/ownership";
import { targetSchoolSchema } from "@/lib/validation/target";
import type { FormResult } from "@/app/actions/profile";

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
  return Number(v);
}
function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}

function parseTarget(fd: FormData) {
  return targetSchoolSchema.safeParse({
    name: text(fd, "name"),
    country: text(fd, "country"),
    course: optText(fd, "course"),
    priority: optNumber(fd, "priority"),
    notes: optText(fd, "notes"),
  });
}

export async function createTargetAction(
  _prev: FormResult,
  fd: FormData,
): Promise<FormResult> {
  const parsed = parseTarget(fd);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const profile = await getOrCreateProfile();
  const d = parsed.data;
  await prisma.targetSchool.create({
    data: {
      profileId: profile.id,
      name: d.name,
      country: d.country,
      course: d.course ?? null,
      priority: d.priority ?? null,
      notes: d.notes ?? null,
    },
  });

  revalidatePath("/targets");
  redirect("/targets");
}

export async function updateTargetAction(
  id: string,
  _prev: FormResult,
  fd: FormData,
): Promise<FormResult> {
  await requireOwnedTargetSchool(id); // throws if not owned

  const parsed = parseTarget(fd);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const d = parsed.data;
  await prisma.targetSchool.update({
    where: { id },
    data: {
      name: d.name,
      country: d.country,
      course: d.course ?? null,
      priority: d.priority ?? null,
      notes: d.notes ?? null,
    },
  });

  revalidatePath("/targets");
  redirect("/targets");
}

export async function deleteTargetAction(fd: FormData): Promise<void> {
  const id = text(fd, "id");
  await requireOwnedTargetSchool(id); // throws if not owned
  await prisma.targetSchool.delete({ where: { id } });
  revalidatePath("/targets");
}
