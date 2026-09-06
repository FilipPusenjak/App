// PATCH /api/commitments/:id — accept, decline, start, or resolve one.
//
// Ownership is established by the WHERE clause rather than by a check after the
// fact: the update targets `{ id, profile: { userId } }`, so a commitment
// belonging to someone else is not "rejected", it simply does not exist to this
// request. That is the same structural pattern as lib/ownership.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requireUserId } from "@/lib/session";
import { commitmentStatusSchema } from "@/lib/validation/tiers";
import {
  plannedItemFromCommitment,
  shouldBeInPlan,
} from "@/lib/plans/from-commitment";

const bodySchema = z.object({
  status: commitmentStatusSchema,
});

/**
 * Which transitions are allowed.
 *
 * PROPOSED can be declined straight to ABANDONED — a student saying "no" to a
 * suggestion is a legitimate answer, and forcing them to accept before they can
 * drop it would corrupt the abandonment signal a later deep review reads.
 * COMPLETED and ABANDONED are terminal: rewriting a resolved commitment would
 * make the follow-through history unreliable, which is the only thing it is for.
 */
const ALLOWED: Record<string, string[]> = {
  PROPOSED: ["ACCEPTED", "ABANDONED"],
  ACCEPTED: ["IN_PROGRESS", "COMPLETED", "ABANDONED"],
  IN_PROGRESS: ["COMPLETED", "ABANDONED"],
  COMPLETED: [],
  ABANDONED: [],
  // Terminal, and unreachable from here in BOTH directions. SUPERSEDED appears
  // as no transition's target anywhere in this map, so a client cannot set it —
  // only a completing review does, and only on a proposal the student never
  // answered. It is empty as a source for the same reason COMPLETED is: a
  // resolved commitment that can be rewritten is not a history.
  SUPERSEDED: [],
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId().catch(() => null);
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }

  const existing = await prisma.commitment.findFirst({
    where: { id, profile: { userId } },
    select: {
      id: true,
      status: true,
      // Read for the plan item this may create — see below.
      profileId: true,
      description: true,
      dueDate: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const next = parsed.data.status;
  if (!ALLOWED[existing.status]?.includes(next)) {
    return NextResponse.json(
      {
        error: `A commitment that is ${existing.status.toLowerCase()} cannot become ${next.toLowerCase()}.`,
      },
      { status: 409 },
    );
  }

  const resolved = next === "COMPLETED" || next === "ABANDONED";

  // The status change and the plan move together or not at all. A student who
  // pressed "I'll do this" and got a commitment marked accepted but nothing in
  // their plan is the bug this route had; half of it succeeding is the same
  // bug with extra steps.
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.commitment.update({
      where: { id: existing.id },
      data: {
        status: next,
        resolvedAt: resolved ? new Date() : null,
      },
      select: { id: true, status: true, resolvedAt: true, description: true },
    });
    await syncPlan(tx, existing, next);
    return row;
  });

  return NextResponse.json(updated);
}

/**
 * Keep the plan in step with the commitment.
 *
 * Accepting one puts it in the plan — which is what the button has always said
 * it does, and until now did not. Resolving one takes it back out, because
 * neither a finished nor an abandoned commitment is still PLANNED, and the
 * projection reads this table to price what the student intends to do next.
 *
 * Both writes are keyed on sourceCommitmentId, so nothing the student typed
 * themselves is ever touched — only the item this commitment created.
 */
async function syncPlan(
  tx: Prisma.TransactionClient,
  commitment: {
    id: string;
    profileId: string;
    description: string;
    dueDate: Date | null;
  },
  next: string,
) {
  if (shouldBeInPlan(next)) {
    // Upsert rather than create: the unique index makes a second accept a
    // constraint violation otherwise, and a double-clicked button would 500 on
    // a request that had already done exactly what was asked.
    await tx.plannedItem.upsert({
      where: { sourceCommitmentId: commitment.id },
      create: {
        ...plannedItemFromCommitment(commitment),
        profileId: commitment.profileId,
        sourceCommitmentId: commitment.id,
      },
      // Nothing on update. Once it is in the plan the student owns it, and
      // re-deriving would wipe edits they made on the Plans page.
      update: {},
    });
    return;
  }

  // deleteMany, not delete: a commitment resolved without ever being accepted
  // has no plan item, and that is not an error.
  await tx.plannedItem.deleteMany({
    where: { sourceCommitmentId: commitment.id },
  });
}
