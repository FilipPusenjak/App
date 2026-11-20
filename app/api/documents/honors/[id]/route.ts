import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDocumentAccess } from "@/lib/documents/entitlement";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const result = await prisma.honor.deleteMany({ where: { id, profileId: gate.profileId } });
  if (result.count === 0) return NextResponse.json({ error: "No such honor." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
