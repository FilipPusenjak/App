// Export the brag sheet: an immutable snapshot, and the PDF to hand over.
import { NextResponse } from "next/server";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { currentCycle } from "@/lib/documents/limits";
import type { BragSheetFields } from "@/lib/documents/fields";
import { exportDraft, getOrCreateDraft, loadSourceSnapshot } from "@/lib/documents/store";
import { renderBragSheetPdf } from "@/lib/documents/render";
import { handleStoreError } from "@/lib/documents/http";

export async function POST() {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;
  const cycle = currentCycle();
  const draft = await getOrCreateDraft(gate.profileId, "BRAG_SHEET", cycle);
  const snapshot = await loadSourceSnapshot(gate.profileId, cycle);
  const fields = draft.fields as unknown as BragSheetFields;
  try {
    const exported = await exportDraft(draft.id);
    const pdf = await renderBragSheetPdf(snapshot, fields);
    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="brag-sheet.pdf"',
        "X-Export-Id": exported.id,
        "X-Replaced-Characters": pdf.replacedCharacters ? "1" : "0",
      },
    });
  } catch (err) {
    return handleStoreError(err);
  }
}
