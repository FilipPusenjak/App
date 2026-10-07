"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { isOperator } from "@/lib/counselor/economics";
import {
  REPORT_KINDS,
  REPORT_REASONS,
  type ReportKind,
} from "@/lib/content-report";

export type ReportState = { ok: true } | { error: string } | undefined;

const MAX_DETAILS = 2000;

/**
 * Report a piece of AI-generated content.
 *
 * The reporter must be somebody who can SEE the thing — otherwise this is a
 * way to probe for ids, and a way to flood the queue with reports about rows
 * the reporter has never read. "Can see" is checked per kind against the same
 * ownership the pages use, and a miss answers exactly like a bad id.
 *
 * Reporting the same thing twice while the first is still open updates that
 * report rather than adding another, so a frustrated double-click does not
 * read as two people.
 */
export async function reportContentAction(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const user = await getCurrentUser();
  if (!user?.id) return { error: "You are not signed in." };

  const kind = String(formData.get("kind") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const details = String(formData.get("details") ?? "").trim().slice(0, MAX_DETAILS);

  if (!(REPORT_KINDS as readonly string[]).includes(kind) || !targetId) {
    return { error: "That can't be reported." };
  }
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
    return { error: "Choose what was wrong with it." };
  }
  if (!(await canSee(user.id, kind as ReportKind, targetId))) {
    return { error: "That can't be reported." };
  }

  const open = await prisma.contentReport.findFirst({
    where: { reporterUserId: user.id, kind, targetId, resolvedAt: null },
    select: { id: true },
  });
  if (open) {
    await prisma.contentReport.update({
      where: { id: open.id },
      data: { reason, details: details || null },
    });
  } else {
    await prisma.contentReport.create({
      data: {
        reporterUserId: user.id,
        kind,
        targetId,
        reason,
        details: details || null,
      },
    });
  }

  revalidatePath("/operations");
  return { ok: true };
}

async function canSee(userId: string, kind: ReportKind, id: string): Promise<boolean> {
  switch (kind) {
    case "EVALUATION":
      return Boolean(
        await prisma.evaluation.findFirst({
          where: { id, profile: { userId } },
          select: { id: true },
        }),
      );
    case "PROJECTION":
      return Boolean(
        await prisma.projection.findFirst({
          where: { id, profile: { userId } },
          select: { id: true },
        }),
      );
    case "SESSION_PREP":
      return Boolean(
        await prisma.sessionPrep.findFirst({
          where: { id, counselorAccount: { userId } },
          select: { id: true },
        }),
      );
    case "PROGRESS_ARTIFACT":
      return Boolean(
        await prisma.progressArtifact.findFirst({
          where: { id, caseloadLink: { counselorAccount: { userId } } },
          select: { id: true },
        }),
      );
  }
}

/** Operator only. Marks a report as looked at; it stays on record. */
export async function resolveContentReportAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!isOperator(user?.email)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.contentReport.updateMany({
    where: { id, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  revalidatePath("/operations");
}
