// Brag sheet settings and stories.
//
// A story is saved EXACTLY as typed — not trimmed, not normalized — because
// it is the one part of the sheet a recommender may quote. Accepting a
// grammar suggestion is the student's own edit; nothing else changes a story.
import { NextResponse } from "next/server";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { currentCycle } from "@/lib/documents/limits";
import { BRAG_TEMPLATES, templateById } from "@/lib/documents/brag-sheet";
import type { BragSheetFields } from "@/lib/documents/fields";
import { getOrCreateDraft, saveDraft } from "@/lib/documents/store";
import { badRequest, handleStoreError, readJson } from "@/lib/documents/http";

const MAX_STORY = 3000;

export async function PATCH(request: Request) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;
  const body = await readJson(request);

  const draft = await getOrCreateDraft(gate.profileId, "BRAG_SHEET", currentCycle());
  const fields = { ...(draft.fields as unknown as BragSheetFields) };
  fields.stories = { ...fields.stories };
  const promptIds = new Set(BRAG_TEMPLATES.flatMap((t) => t.prompts.map((p) => p.id)));

  if (typeof body.templateId === "string") {
    if (!BRAG_TEMPLATES.some((t) => t.id === body.templateId)) return badRequest("No such template.");
    fields.templateId = body.templateId;
  }
  if (typeof body.grammarOptIn === "boolean") {
    fields.grammarOptIn = body.grammarOptIn;
    // Turning it off withdraws any pending suggestion; stories are untouched.
    if (!body.grammarOptIn) {
      for (const id of Object.keys(fields.stories)) {
        fields.stories[id] = { ...fields.stories[id]!, grammarSuggestion: null };
      }
    }
  }
  if (body.story && typeof body.story === "object") {
    const s = body.story as { promptId?: unknown; text?: unknown };
    if (typeof s.promptId !== "string" || !promptIds.has(s.promptId) || typeof s.text !== "string") {
      return badRequest("Which story, and what does it say?");
    }
    if (s.text.length > MAX_STORY) return badRequest(`Keep each story under ${MAX_STORY} characters.`);
    fields.stories[s.promptId] = { text: s.text, grammarSuggestion: null };
  }
  for (const action of ["acceptGrammar", "rejectGrammar"] as const) {
    const promptId = body[action];
    if (typeof promptId !== "string") continue;
    const story = fields.stories[promptId];
    if (!story?.grammarSuggestion) return badRequest("There's no suggestion for that story.");
    fields.stories[promptId] =
      action === "acceptGrammar"
        ? { text: story.grammarSuggestion, grammarSuggestion: null }
        : { ...story, grammarSuggestion: null };
  }

  try {
    await saveDraft(draft.id, { fields });
  } catch (err) {
    return handleStoreError(err);
  }
  return NextResponse.json({ ok: true, template: templateById(fields.templateId).id });
}
