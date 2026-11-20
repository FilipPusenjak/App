// Adding an honor. The Honors section is assembled by code from these — title,
// grades, level of recognition — with no model involved.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { GRADE_LEVELS, RECOGNITION_LEVELS } from "@/lib/documents/limits";
import { badRequest, readJson } from "@/lib/documents/http";

const honorSchema = z.object({
  title: z.string().trim().min(1, { error: "Give the honor a title." }).max(300),
  gradeLevels: z
    .array(z.number().int().refine((g) => (GRADE_LEVELS as readonly number[]).includes(g)))
    .max(GRADE_LEVELS.length)
    .default([]),
  recognitionLevel: z.enum(RECOGNITION_LEVELS, { error: "Choose the level of recognition." }),
});

export async function POST(request: Request) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;
  const parsed = honorSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "That honor isn't valid.");
  const honor = await prisma.honor.create({
    data: {
      profileId: gate.profileId,
      title: parsed.data.title,
      gradeLevels: [...new Set(parsed.data.gradeLevels)].sort((a, b) => a - b),
      recognitionLevel: parsed.data.recognitionLevel,
    },
  });
  return NextResponse.json({ ok: true, id: honor.id });
}
