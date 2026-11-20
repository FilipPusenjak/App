// Download an earlier export again, drawn from its pinned snapshot — so it is
// what was exported, not what the profile says today. A resume comes back
// without contact details unless the student chose to have them remembered.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import type { BragSheetFields, ResumeFields } from "@/lib/documents/fields";
import type { SourceSnapshot } from "@/lib/documents/store";
import { buildResumeContent, renderBragSheetPdf } from "@/lib/documents/render";
import { renderResumePdf, type ResumeContent } from "@/lib/documents/resume-pdf";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const doc = await prisma.applicationDocument.findFirst({
    where: { id, profileId: gate.profileId, status: "EXPORTED" },
  });
  if (!doc) return NextResponse.json({ error: "No such export." }, { status: 404 });
  const snapshot = doc.sourceSnapshot as unknown as SourceSnapshot;

  let bytes: Uint8Array;
  if (doc.type === "RESUME_PDF") {
    // Exactly what was printed, as recorded at export — not rebuilt from today.
    const fields = doc.fields as unknown as ResumeFields & { printed?: Omit<ResumeContent, "contact"> };
    const saved = await prisma.savedResumeContact.findUnique({ where: { profileId: gate.profileId } });
    const contact = {
      name: saved?.name ?? snapshot.student.name ?? "",
      email: saved?.email,
      phone: saved?.phone,
      address: saved?.address,
    };
    const content: ResumeContent = fields.printed
      ? { ...fields.printed, contact }
      : buildResumeContent(snapshot, fields, null, contact);
    bytes = (await renderResumePdf(content)).bytes;
  } else if (doc.type === "BRAG_SHEET") {
    bytes = (await renderBragSheetPdf(snapshot, doc.fields as unknown as BragSheetFields)).bytes;
  } else {
    return NextResponse.json({ error: "This export is a list to copy, not a PDF." }, { status: 400 });
  }
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${doc.type === "RESUME_PDF" ? "resume" : "brag-sheet"}-${doc.cycle}.pdf"`,
    },
  });
}
