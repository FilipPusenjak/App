// The student editing one field. From then on it is theirs: regeneration
// skips it (see applyEdit in lib/documents/fields.ts).
import { NextResponse } from "next/server";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { currentCycle } from "@/lib/documents/limits";
import { applyEdit, type CommonAppFields } from "@/lib/documents/fields";
import { getOrCreateDraft, saveDraft } from "@/lib/documents/store";
import { badRequest, handleStoreError, readJson } from "@/lib/documents/http";

const FIELDS = ["description", "position", "organization"] as const;

export async function PATCH(request: Request) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;

  const body = await readJson(request);
  const activityId = typeof body.activityId === "string" ? body.activityId : null;
  const field = FIELDS.find((f) => f === body.field);
  const value = typeof body.value === "string" ? body.value : null;
  if (!activityId || !field || value === null) return badRequest("Which field, and what should it say?");
  if (value.length > 2000) return badRequest("That's far longer than any field allows.");

  const draft = await getOrCreateDraft(gate.profileId, "COMMON_APP_ACTIVITIES", currentCycle());
  const fields = draft.fields as unknown as CommonAppFields;
  if (!fields.entries[activityId]) {
    return NextResponse.json({ error: "That activity isn't in this document." }, { status: 404 });
  }
  const next = applyEdit(fields, draft.editedFieldKeys, activityId, field, value);
  try {
    await saveDraft(draft.id, { fields: next.fields, editedFieldKeys: next.editedFieldKeys });
  } catch (err) {
    return handleStoreError(err);
  }
  return NextResponse.json({ ok: true });
}
