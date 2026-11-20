// Answering a gap question about one activity.
//
// The answer is written to the PROFILE — the resume item itself — not to a
// document. The document reads it from there, and so does everything else in
// the app, so answering "how many weeks a year?" once makes the whole profile
// more complete rather than patching one export.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { COMMON_APP_ACTIVITY_TYPES, GRADE_LEVELS, TIMINGS } from "@/lib/documents/limits";
import { badRequest, readJson } from "@/lib/documents/http";

const answerSchema = z
  .object({
    commonAppType: z.enum(COMMON_APP_ACTIVITY_TYPES),
    positionTitle: z.string().trim().max(200).nullable(),
    gradeLevels: z
      .array(z.number().int().refine((g) => (GRADE_LEVELS as readonly number[]).includes(g)))
      .max(GRADE_LEVELS.length),
    timing: z.enum(TIMINGS),
    hoursPerWeek: z.number().min(0).max(168),
    weeksPerYear: z.number().int().min(0).max(52),
    /** Appends one fact. */
    addFact: z.string().trim().min(1).max(300),
    /** Replaces the list, for editing or removing facts. */
    facts: z.array(z.string().trim().min(1).max(300)).max(20),
  })
  .partial()
  .strict();

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;

  const parsed = answerSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "That answer isn't valid.");

  // Scoped to the student's own current profile: an id from anywhere else is
  // simply not found.
  const item = await prisma.resumeItem.findFirst({
    where: { id, profileId: gate.profileId },
    select: { id: true, facts: true },
  });
  if (!item) return NextResponse.json({ error: "No such activity." }, { status: 404 });

  const a = parsed.data;
  const updated = await prisma.resumeItem.update({
    where: { id: item.id },
    data: {
      ...(a.commonAppType !== undefined ? { commonAppType: a.commonAppType } : {}),
      ...(a.positionTitle !== undefined ? { positionTitle: a.positionTitle || null } : {}),
      ...(a.gradeLevels !== undefined ? { gradeLevels: [...new Set(a.gradeLevels)].sort((x, y) => x - y) } : {}),
      ...(a.timing !== undefined ? { timing: a.timing } : {}),
      ...(a.hoursPerWeek !== undefined ? { hoursPerWeek: a.hoursPerWeek } : {}),
      ...(a.weeksPerYear !== undefined ? { weeksPerYear: a.weeksPerYear } : {}),
      ...(a.facts !== undefined ? { facts: a.facts } : {}),
      ...(a.addFact !== undefined ? { facts: [...item.facts, a.addFact] } : {}),
    },
    select: {
      commonAppType: true, positionTitle: true, gradeLevels: true, timing: true,
      hoursPerWeek: true, weeksPerYear: true, facts: true,
    },
  });
  return NextResponse.json({ ok: true, activity: updated });
}
