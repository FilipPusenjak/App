// Resume settings: skills (the student's own list) and whether GPA is printed.
import { NextResponse } from "next/server";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { currentCycle } from "@/lib/documents/limits";
import type { ResumeFields } from "@/lib/documents/fields";
import { getOrCreateDraft, saveDraft } from "@/lib/documents/store";
import { badRequest, handleStoreError, readJson } from "@/lib/documents/http";

export async function PATCH(request: Request) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;
  const body = await readJson(request);
  const draft = await getOrCreateDraft(gate.profileId, "RESUME_PDF", currentCycle());
  const fields = { ...(draft.fields as unknown as ResumeFields) };

  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills) || !body.skills.every((s) => typeof s === "string")) {
      return badRequest("Skills should be a list.");
    }
    const skills = (body.skills as string[]).map((s) => s.trim()).filter(Boolean);
    if (skills.length > 30 || skills.some((s) => s.length > 60)) {
      return badRequest("Keep it to 30 skills of up to 60 characters each.");
    }
    fields.skills = skills;
  }
  if (typeof body.includeGpa === "boolean") fields.includeGpa = body.includeGpa;

  try {
    await saveDraft(draft.id, { fields });
  } catch (err) {
    return handleStoreError(err);
  }
  return NextResponse.json({ ok: true });
}
