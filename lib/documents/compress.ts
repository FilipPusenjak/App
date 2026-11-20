// Shortening a description to fit a limit — the model's ONLY job in the
// document builder.
//
// The model may compress and rephrase what the student entered. It may never
// add to it. The prompt says so; code checks it:
//
//   1. Character counts are measured here, never taken from the model. Over
//      the limit -> one retry with the overage stated -> still over: handed to
//      the student flagged. Never truncated, because a cut mid-fact can change
//      what the fact says.
//   2. Every output goes through checkFidelity. A violation -> one retry with
//      the violation stated -> still failing: handed to the student with the
//      offending word named. Every failure is returned for logging with the
//      model that produced it.
//
// Outputs that pass both are cached by everything that went into them, so an
// unchanged activity never costs a second call.
import { createHash } from "node:crypto";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { estimateCost } from "@/lib/cost";
import { estimateInputTokens, maxOutputTokensFor, RUN_BUDGET_USD } from "@/lib/cost-budget";
import { RUNG_LABELS } from "@/lib/readiness/rungs";
import { charCount, gradeLabel, TIMING_LABELS, type Timing } from "./limits";
import {
  fidelitySourceText,
  hasDescribableContent,
  type ActivitySource,
} from "./activities";
import { checkFidelity, type FidelityViolation } from "./fidelity";

export const COMPRESSION_PROMPT_VERSION = "documents/compress-v1";

export const COMPRESSION_SYSTEM_PROMPT = `You shorten a student's own description of an activity so it fits a field on a US college application.

You may COMPRESS and REPHRASE. You may never ADD.

- Use only the facts supplied for that entry. Do not add numbers, names, titles, roles, outcomes, impact or recognition that are not in them.
- Do not upgrade what the student did. If they "attended" or "helped", do not write "led", "organized", "founded", "managed", "launched", "spearheaded", "directed", "created", "won" or "promoted" unless their own words say so.
- Do not repeat the position or the organization: those are separate fields and the reader sees them already. Spend the characters on what the student did.
- Fragment style is fine. Semicolons to stack items. Abbreviate only where it stays clear.
- Stay under the character limit given for each entry. Shorter is fine; there is no need to fill the limit.
- The rung is the app's own label for how far along the activity is. It is context only: never write it.
- If an entry has very little to work with, write very little. A short true description is the right answer.

Return JSON: {"entries": [{"entryId": "...", "description": "..."}]} with one item for every entry you were given.`;

const outputSchema = z.object({
  entries: z.array(z.object({ entryId: z.string(), description: z.string() })),
});
const OUTPUT_FORMAT = zodOutputFormat(outputSchema);

export type CompressionEntry = {
  entryId: string;
  source: ActivitySource;
  limit: number;
  /** As they will appear in their own fields — so the model does not repeat them. */
  position: string;
  organization: string;
};

export type EntryFlag = {
  kind: "over_limit" | "fidelity" | "no_content" | "no_output";
  message: string;
  /** For fidelity flags: the words to highlight. */
  tokens?: string[];
};

export type CompressionResult = {
  entryId: string;
  description: string;
  sourceHash: string;
  fromCache: boolean;
  flag: EntryFlag | null;
};

export type FidelityFailureRecord = {
  entryId: string;
  attempt: number;
  model: string;
  violations: FidelityViolation[];
};

/** The subset of the Anthropic client this module uses. Injected for tests. */
export type MessagesClient = {
  messages: {
    create(args: Record<string, unknown>): Promise<{
      content: { type: string; text?: string }[];
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      };
      stop_reason?: string | null;
    }>;
  };
};

export type CompressionCacheStore = {
  get(hash: string): Promise<string | null>;
  put(hash: string, output: string, model: string): Promise<void>;
};

/** What the model is shown for one entry, minus any retry note. */
function entryPayload(e: CompressionEntry) {
  const s = e.source;
  return {
    entryId: e.entryId,
    characterLimit: e.limit,
    activityType: s.commonAppType ?? s.itemType,
    title: s.title,
    position: e.position || null,
    organization: e.organization || null,
    facts: s.facts,
    description: s.description ?? null,
    evidence: s.evidenceNotes ?? null,
    hoursPerWeek: s.hoursPerWeek,
    weeksPerYear: s.weeksPerYear,
    grades: s.gradeLevels.map(gradeLabel),
    timing: s.timing ? (TIMING_LABELS[s.timing as Timing] ?? null) : null,
    rung: RUNG_LABELS[s.rung],
  };
}

/**
 * The cache key: every input the model sees, the limit, and the prompt version.
 * Change any of them and the entry is generated afresh.
 */
export function compressionSourceHash(e: CompressionEntry): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: COMPRESSION_PROMPT_VERSION, ...entryPayload(e) }))
    .digest("hex");
}

/** Running token totals. Unlike the shared TokenUsage, never null. */
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

export type CompressionRun = {
  results: CompressionResult[];
  usage: Usage;
  costUsd: number;
  modelCalls: number;
  cacheHits: number;
  fidelityFailures: FidelityFailureRecord[];
};

type Pending = {
  entry: CompressionEntry;
  hash: string;
  attempt: number;
  limitRetried: boolean;
  fidelityRetried: boolean;
  note: string | null;
  last: string | null;
};

/**
 * Shorten every entry that needs it, in as few calls as possible.
 *
 * At most three model calls however many entries there are: the first batch,
 * one batch of length retries, one batch of fidelity retries.
 */
export async function compressEntries(input: {
  entries: CompressionEntry[];
  client: MessagesClient;
  model: string;
  cache: CompressionCacheStore;
}): Promise<CompressionRun> {
  const { client, model, cache } = input;
  const results: CompressionResult[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
  const fidelityFailures: FidelityFailureRecord[] = [];
  let modelCalls = 0;
  let cacheHits = 0;

  let pending: Pending[] = [];
  for (const entry of input.entries) {
    const hash = compressionSourceHash(entry);
    // Nothing to compress: never let the model write a description out of a
    // title alone. It stays empty and flagged, and the gap question asks.
    if (!hasDescribableContent(entry.source)) {
      results.push({
        entryId: entry.entryId,
        description: "",
        sourceHash: hash,
        fromCache: false,
        flag: {
          kind: "no_content",
          message: "There's nothing yet to describe. Add a concrete fact about this activity, then generate again.",
        },
      });
      continue;
    }
    const cached = await cache.get(hash);
    if (cached !== null) {
      cacheHits += 1;
      results.push({ entryId: entry.entryId, description: cached, sourceHash: hash, fromCache: true, flag: null });
      continue;
    }
    pending.push({ entry, hash, attempt: 0, limitRetried: false, fidelityRetried: false, note: null, last: null });
  }

  while (pending.length > 0 && modelCalls < 3) {
    const batch = pending;
    pending = [];
    const outputs = await callModel(client, model, batch, usage);
    modelCalls += 1;

    for (const p of batch) {
      p.attempt += 1;
      const text = outputs.get(p.entry.entryId);
      if (text === undefined) {
        if (!p.limitRetried) {
          pending.push({ ...p, limitRetried: true, note: "You did not return this entry last time. Return it." });
        } else {
          results.push({
            entryId: p.entry.entryId,
            description: p.last ?? "",
            sourceHash: p.hash,
            fromCache: false,
            flag: { kind: "no_output", message: "The description didn't come back. Write it yourself, or generate again." },
          });
        }
        continue;
      }

      const length = charCount(text);
      if (length > p.entry.limit) {
        if (!p.limitRetried) {
          pending.push({
            ...p,
            last: text,
            limitRetried: true,
            note: `Your last version was ${length} characters, ${length - p.entry.limit} over the ${p.entry.limit}-character limit. Write it again, shorter, without dropping any fact's meaning. Last version: ${text}`,
          });
        } else {
          results.push({
            entryId: p.entry.entryId,
            description: text,
            sourceHash: p.hash,
            fromCache: false,
            flag: {
              kind: "over_limit",
              message: `${length} characters — ${length - p.entry.limit} over the ${p.entry.limit} limit. Shorten it here; it was not cut automatically so nothing changes meaning.`,
            },
          });
        }
        continue;
      }

      const violations = checkFidelity(text, [fidelitySourceText(p.entry.source)]);
      if (violations.length > 0) {
        fidelityFailures.push({ entryId: p.entry.entryId, attempt: p.attempt, model, violations });
        if (!p.fidelityRetried) {
          pending.push({
            ...p,
            last: text,
            fidelityRetried: true,
            note: `Your last version added things the student did not enter: ${violations.map((v) => v.message).join(" ")} Write it again using only the supplied facts. Last version: ${text}`,
          });
        } else {
          results.push({
            entryId: p.entry.entryId,
            description: text,
            sourceHash: p.hash,
            fromCache: false,
            flag: {
              kind: "fidelity",
              message: violations.map((v) => v.message).join(" "),
              tokens: violations.map((v) => v.token),
            },
          });
        }
        continue;
      }

      await cache.put(p.hash, text, model);
      results.push({ entryId: p.entry.entryId, description: text, sourceHash: p.hash, fromCache: false, flag: null });
    }
  }

  // Anything still pending ran out of calls — flag rather than drop.
  for (const p of pending) {
    results.push({
      entryId: p.entry.entryId,
      description: p.last ?? "",
      sourceHash: p.hash,
      fromCache: false,
      flag: { kind: "no_output", message: "This one couldn't be finished. Edit it yourself, or generate again." },
    });
  }

  return {
    results,
    usage,
    costUsd: estimateCost(usage, model) ?? 0,
    modelCalls,
    cacheHits,
    fidelityFailures,
  };
}

async function callModel(
  client: MessagesClient,
  model: string,
  batch: Pending[],
  usage: Usage,
): Promise<Map<string, string>> {
  const userPrompt = JSON.stringify({
    entries: batch.map((p) => ({ ...entryPayload(p.entry), ...(p.note ? { problemWithLastVersion: p.note } : {}) })),
  });
  // Sized from the budget like every other route: whatever the prompt leaves
  // of it, capped at what this many short descriptions could possibly need.
  const allowance = Math.min(
    maxOutputTokensFor({
      budgetUsd: RUN_BUDGET_USD.DOCUMENT_COMPRESSION,
      inputTokens: estimateInputTokens(COMPRESSION_SYSTEM_PROMPT, userPrompt),
      model,
      cachesInput: false,
    }),
    200 + batch.length * 150,
  );

  const message = await client.messages.create({
    model,
    max_tokens: allowance,
    system: COMPRESSION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    output_config: { format: OUTPUT_FORMAT, effort: "low" },
  });
  usage.inputTokens += message.usage.input_tokens;
  usage.outputTokens += message.usage.output_tokens;
  usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
  usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;

  const text = message.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
  const out = new Map<string, string>();
  try {
    const parsed = outputSchema.safeParse(JSON.parse(text));
    if (parsed.success) {
      for (const e of parsed.data.entries) out.set(e.entryId, e.description.trim());
    }
  } catch {
    // Unparseable: every entry in the batch counts as not returned.
  }
  return out;
}
