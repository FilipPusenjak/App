// One generation run of the Common App list: what to generate, under which
// cap, through the cache and the model, written back without touching
// anything the student edited, and logged with its cost and every fidelity
// failure.
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { capDecision, runsThisMonth } from "./caps";
import {
  compressEntries,
  compressionSourceHash,
  type CompressionCacheStore,
  type CompressionEntry,
  type MessagesClient,
} from "./compress";
import { applyGenerated, entryKey, type CommonAppFields } from "./fields";
import { addUsage, refreshCommonAppDraft, saveDraft, type SourceSnapshot } from "./store";

/** The compression cache, in Postgres. */
export const dbCompressionCache: CompressionCacheStore = {
  async get(hash) {
    const row = await prisma.compressionCache.findUnique({ where: { sourceHash: hash } });
    return row?.output ?? null;
  },
  async put(hash, output, model) {
    await prisma.compressionCache.upsert({
      where: { sourceHash: hash },
      create: { sourceHash: hash, output, modelUsed: model },
      update: {},
    });
  },
};

export type GenerateOutcome =
  | {
      ok: true;
      written: string[];
      skippedEdited: string[];
      flagged: string[];
      modelCalls: number;
      cacheHits: number;
    }
  | { ok: false; status: number; error: string };

export async function generateCommonAppDescriptions(input: {
  profileId: string;
  cycle: string;
  /** null = the whole list. */
  activityId: string | null;
  client: MessagesClient;
  model: string;
  now?: Date;
}): Promise<GenerateOutcome> {
  const draft = await refreshCommonAppDraft(input.profileId, input.cycle);
  const fields = draft.fields as CommonAppFields;
  const snapshot = draft.sourceSnapshot as unknown as SourceSnapshot;
  const byId = new Map(snapshot.activities.map((a) => [a.id, a]));

  let ids: string[];
  if (input.activityId) {
    if (!byId.has(input.activityId)) {
      return { ok: false, status: 404, error: "That activity isn't in this document." };
    }
    ids = [input.activityId];
  } else {
    ids = fields.order;
  }

  const edited = new Set(draft.editedFieldKeys);
  const skippedEdited = ids.filter((id) => edited.has(entryKey(id, "description")));
  const entries: CompressionEntry[] = ids
    .filter((id) => !edited.has(entryKey(id, "description")))
    .map((id) => ({
      entryId: id,
      source: byId.get(id)!,
      limit: snapshot.limits.description,
      position: fields.entries[id]?.position ?? "",
      organization: fields.entries[id]?.organization ?? "",
    }));

  if (entries.length === 0) {
    return { ok: true, written: [], skippedEdited, flagged: [], modelCalls: 0, cacheHits: 0 };
  }

  // The cap is about model calls. A run the cache can answer whole is free and
  // is always allowed; one that needs the model must be within the cap.
  const scope = input.activityId ? "ENTRY" : "LIST";
  const needsModel = await Promise.all(
    entries.map(async (e) => (await dbCompressionCache.get(compressionSourceHash(e))) === null),
  );
  if (needsModel.some(Boolean)) {
    const used = await runsThisMonth({
      profileId: input.profileId,
      scope,
      entryKey: input.activityId ?? undefined,
      now: input.now,
    });
    const decision = capDecision(scope, used);
    if (!decision.ok) return { ok: false, status: 429, error: decision.message };
  }

  const run = await compressEntries({
    entries,
    client: input.client,
    model: input.model,
    cache: dbCompressionCache,
  });

  const applied = applyGenerated(fields, draft.editedFieldKeys, run.results);
  await saveDraft(draft.id, { fields: applied.fields });
  await addUsage(draft.id, {
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    costUsd: run.costUsd,
  });

  const flagged = run.results.filter((r) => r.flag).map((r) => r.entryId);
  await prisma.documentGenerationLog.create({
    data: {
      profileId: input.profileId,
      documentId: draft.id,
      scope,
      entryKey: input.activityId,
      modelUsed: run.modelCalls > 0 ? input.model : null,
      modelCalls: run.modelCalls,
      cacheHits: run.cacheHits,
      inputTokens: run.usage.inputTokens,
      outputTokens: run.usage.outputTokens,
      costCents: run.costUsd * 100,
      flaggedEntries: flagged.length,
      fidelityFailures:
        run.fidelityFailures.length > 0
          ? (run.fidelityFailures as unknown as Prisma.InputJsonValue)
          : undefined,
    },
  });
  if (run.fidelityFailures.length > 0) {
    // Visible in the deployment logs as well as the table: a spike here after
    // a model change is the signal that it has started inflating.
    console.warn("[documents] fidelity failures", {
      model: input.model,
      count: run.fidelityFailures.length,
      kinds: run.fidelityFailures.flatMap((f) => f.violations.map((v) => v.kind)),
    });
  }

  return {
    ok: true,
    written: applied.written,
    skippedEdited: [...skippedEdited, ...applied.skipped],
    flagged,
    modelCalls: run.modelCalls,
    cacheHits: run.cacheHits,
  };
}
