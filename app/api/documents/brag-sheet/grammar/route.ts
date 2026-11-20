// Suggest a grammar-only correction of one story. Opt-in.
//
// The suggestion is checked by checkGrammarOnly: any added or dropped content
// word, or anything the fidelity check catches, sends it back once; failing
// again, nothing is suggested at all. It is stored beside the story and
// replaces nothing until the student accepts it.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireDocumentAccess } from "@/lib/documents/entitlement";
import { hasAiConsent, ownConsentRequired } from "@/lib/ai-consent";
import { getAnthropicClient, getDocumentModel } from "@/lib/anthropic";
import { estimateCost } from "@/lib/cost";
import { currentCycle } from "@/lib/documents/limits";
import { capDecision, runsThisMonth } from "@/lib/documents/caps";
import { checkGrammarOnly, GRAMMAR_SYSTEM_PROMPT } from "@/lib/documents/grammar";
import type { BragSheetFields } from "@/lib/documents/fields";
import type { MessagesClient } from "@/lib/documents/compress";
import { addUsage, getOrCreateDraft, saveDraft } from "@/lib/documents/store";
import { badRequest, handleStoreError, readJson } from "@/lib/documents/http";

export async function POST(request: Request) {
  const gate = await requireDocumentAccess();
  if (!gate.ok) return gate.response;
  if (!(await hasAiConsent(gate.userId))) return ownConsentRequired();

  const body = await readJson(request);
  const promptId = typeof body.promptId === "string" ? body.promptId : null;
  if (!promptId) return badRequest("Which story?");

  const draft = await getOrCreateDraft(gate.profileId, "BRAG_SHEET", currentCycle());
  const fields = draft.fields as unknown as BragSheetFields;
  if (!fields.grammarOptIn) {
    return NextResponse.json({ error: "Grammar fixes are off. Turn them on first." }, { status: 409 });
  }
  const original = fields.stories[promptId]?.text ?? "";
  if (!original.trim()) return badRequest("Write the story first.");

  const used = await runsThisMonth({ profileId: gate.profileId, scope: "GRAMMAR", entryKey: promptId });
  const decision = capDecision("GRAMMAR", used);
  if (!decision.ok) return NextResponse.json({ error: decision.message }, { status: 429 });

  const client = getAnthropicClient() as unknown as MessagesClient | null;
  if (!client) {
    return NextResponse.json({ error: "AI isn't connected on this deployment." }, { status: 503 });
  }
  const model = getDocumentModel();

  const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  const failures: unknown[] = [];
  let suggestion: string | null = null;
  let note = "";
  for (let attempt = 1; attempt <= 2 && suggestion === null; attempt++) {
    const message = await client.messages.create({
      model,
      max_tokens: Math.min(4000, Math.ceil(original.length / 2) + 200),
      system: GRAMMAR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: note ? `${note}\n\nText:\n${original}` : original }],
    });
    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;
    const text = message.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("").trim();
    const check = checkGrammarOnly(original, text);
    if (check.ok) {
      suggestion = text;
    } else {
      failures.push({ attempt, model, added: check.added, removed: check.removed, violations: check.violations });
      note = `Your last correction changed what the student said (added: ${check.added.join(", ") || "none"}; removed: ${check.removed.join(", ") || "none"}). Fix only spelling, grammar and punctuation.`;
    }
  }

  const costUsd = estimateCost(usage, model) ?? 0;
  await prisma.documentGenerationLog.create({
    data: {
      profileId: gate.profileId,
      documentId: draft.id,
      scope: "GRAMMAR",
      entryKey: promptId,
      modelUsed: model,
      modelCalls: failures.length + (suggestion ? 1 : 0),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costCents: costUsd * 100,
      flaggedEntries: suggestion ? 0 : 1,
      fidelityFailures: failures.length ? (failures as object) : undefined,
    },
  });
  await addUsage(draft.id, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd });

  if (suggestion === null) {
    return NextResponse.json(
      { error: "A grammar fix couldn't be made without changing what you said, so none is suggested. Your story is unchanged." },
      { status: 422 },
    );
  }
  if (suggestion === original) {
    return NextResponse.json({ ok: true, unchanged: true });
  }
  const next: BragSheetFields = {
    ...fields,
    stories: { ...fields.stories, [promptId]: { text: original, grammarSuggestion: suggestion } },
  };
  try {
    await saveDraft(draft.id, { fields: next });
  } catch (err) {
    return handleStoreError(err);
  }
  return NextResponse.json({ ok: true, suggestion });
}
