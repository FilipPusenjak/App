"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrCreateProfile, requireOwnedPlannedItem } from "@/lib/ownership";
import { plannedItemSchema } from "@/lib/validation/plan";
import type { FormResult } from "@/app/actions/profile";

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}

function parsePlan(fd: FormData) {
  return plannedItemSchema.safeParse({
    type: text(fd, "type"),
    title: text(fd, "title"),
    org: text(fd, "org"),
    description: text(fd, "description"),
    targetDate: text(fd, "targetDate"),
    hoursPerWeek: text(fd, "hoursPerWeek"),
  });
}

export async function createPlanAction(
  _prev: FormResult,
  fd: FormData,
): Promise<FormResult> {
  const parsed = parsePlan(fd);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const profile = await getOrCreateProfile();
  const d = parsed.data;
  await prisma.plannedItem.create({
    data: {
      profileId: profile.id,
      type: d.type,
      title: d.title,
      org: d.org ?? null,
      description: d.description ?? null,
      targetDate: d.targetDate ?? null,
      hoursPerWeek: d.hoursPerWeek ?? null,
    },
  });

  revalidatePath("/plans");
  redirect("/plans");
}

export async function updatePlanAction(
  id: string,
  _prev: FormResult,
  fd: FormData,
): Promise<FormResult> {
  await requireOwnedPlannedItem(id); // throws if not owned

  const parsed = parsePlan(fd);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const d = parsed.data;
  await prisma.plannedItem.update({
    where: { id },
    data: {
      type: d.type,
      title: d.title,
      org: d.org ?? null,
      description: d.description ?? null,
      targetDate: d.targetDate ?? null,
      hoursPerWeek: d.hoursPerWeek ?? null,
    },
  });

  revalidatePath("/plans");
  redirect("/plans");
}

export async function deletePlanAction(fd: FormData): Promise<void> {
  const id = text(fd, "id");
  await requireOwnedPlannedItem(id); // throws if not owned
  await prisma.plannedItem.delete({ where: { id } });
  revalidatePath("/plans");
}

/**
 * Turn a completed plan into a real resume item.
 *
 * The point of the whole plans/achievements split is that intentions never
 * count until they happen — so this is the moment a plan becomes real, and it
 * is an explicit action the student takes rather than anything automatic.
 */
export async function markPlanDoneAction(fd: FormData): Promise<void> {
  const id = text(fd, "id");
  const plan = await requireOwnedPlannedItem(id); // throws if not owned

  await prisma.$transaction([
    prisma.resumeItem.create({
      data: {
        profileId: plan.profileId,
        type: plan.type,
        title: plan.title,
        org: plan.org,
        description: plan.description,
        hoursPerWeek: plan.hoursPerWeek,
      },
    }),
    prisma.plannedItem.delete({ where: { id } }),
  ]);

  revalidatePath("/plans");
  revalidatePath("/profile");
}
