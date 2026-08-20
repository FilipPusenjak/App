// PATCH /api/commitments/:id — accept, decline, start, or resolve one.
//
// Ownership is established by the WHERE clause rather than by a check after the
// fact: the update targets `{ id, profile: { userId } }`, so a commitment
// belonging to someone else is not "rejected", it simply does not exist to this
// request. That is the same structural pattern as lib/ownership.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { commitmentStatusSchema } from "@/lib/validation/tiers";

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
    select: { id: true, status: true },
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
  const updated = await prisma.commitment.update({
    where: { id: existing.id },
    data: {
      status: next,
      resolvedAt: resolved ? new Date() : null,
    },
    select: { id: true, status: true, resolvedAt: true, description: true },
  });

  return NextResponse.json(updated);
}
