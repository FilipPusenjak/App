"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrCreateProfile, requireOwnedPlannedItem } from "@/lib/ownership";
import { plannedItemSchema } from "@/lib/validation/plan";
import { isEvaluationId } from "@/lib/plans/from-action";
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

  // Back to the evaluation this was drafted from, when it was drafted from one.
  // The student was working down a ranked list of actions; landing them on
  // /plans loses their place, and the second action never gets added.
  //
  // The PATH is built here from an id that was validated first. The value came
  // in through a URL and a form field, so it is attacker-supplied — treating it
  // as a destination rather than an identifier is how this becomes an open
  // redirect. Anything that is not a plausible id falls through to /plans.
  const from = text(fd, "from");
  if (isEvaluationId(from)) {
    revalidatePath(`/evaluations/${from}`);
    redirect(`/evaluations/${from}`);
  }
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
