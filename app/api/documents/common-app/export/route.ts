// Export the Common App list: an immutable snapshot of exactly what the
// student will paste, refused while anything is over its limit or the order is
// unconfirmed.
import { NextResponse } from "next/server";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { currentCycle } from "@/lib/documents/limits";
import type { CommonAppFields } from "@/lib/documents/fields";
import { commonAppExportProblems, exportDraft, refreshCommonAppDraft } from "@/lib/documents/store";
import { handleStoreError } from "@/lib/documents/http";

export async function POST() {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;

  const draft = await refreshCommonAppDraft(gate.profileId, currentCycle());
  const problems = commonAppExportProblems(
    draft.fields as CommonAppFields,
    draft.sourceSnapshot.limits,
    draft.orderConfirmedAt !== null,
  );
  if (problems.length > 0) {
    return NextResponse.json({ error: problems[0], problems }, { status: 422 });
  }
  try {
    const exported = await exportDraft(draft.id);
    return NextResponse.json({ ok: true, id: exported.id });
  } catch (err) {
    return handleStoreError(err);
  }
}
