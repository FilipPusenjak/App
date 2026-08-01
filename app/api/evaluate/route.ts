// POST /api/evaluate — the only place the Anthropic API is called.
//
// Server-side only. The browser never sees the API key; it can only ask this
// route to run an evaluation for the currently authenticated user. The profile
// is loaded through the ownership helpers, so there is no way for a client to
// request an evaluation of someone else's data — no id is accepted from the
// request body at all.
import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getProfileWithRelations } from "@/lib/ownership";
import { evaluationRateLimiter } from "@/lib/rate-limit";
import {
  getAnthropicClient,
  getModel,
  getEffort,
  getCacheControl,
} from "@/lib/anthropic";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import { buildSampleResult } from "@/lib/evaluation/sample";
import { loadPreviousContext } from "@/lib/evaluation/previous";
import { mergeItemAssessments } from "@/lib/evaluation/item-reuse";
import { failStalePendingEvaluations } from "@/lib/evaluation/stale-sweep";
import {
  SYSTEM_PROMPT,
  buildUserPromptParts,
  PROMPT_VERSION,
} from "@/lib/prompts/evaluation";
import type { EvaluationResult } from "@/lib/validation/evaluation";
import {
  evaluationWireSchema,
  fromWireResult,
} from "@/lib/validation/evaluation-wire";
import {
  isGrammarTooLargeError,
  isStructuredOutputParseError,
  parseModelJson,
  renderRetryNote,
  renderSchemaInstructions,
  type ModelAttempt,
} from "@/lib/structured-output";

// Thinking + a structured result need headroom; stream so long runs don't hit
// an HTTP timeout.
const MAX_TOKENS = 32000;

/**
 * Maximum seconds this route may run for.
 *
 * A real evaluation genuinely takes tens of seconds, and hosting platforms
 * enforce a much shorter default. Without this the function is killed
 * mid-stream in production — the tokens are paid for, but the answer is lost —
 * while working perfectly on localhost, where no such limit exists.
 *
 * 60s is the ceiling on Vercel's Hobby plan; platforms that allow more will
 * honor a larger number here, and any run that still overruns is recovered by
 * the stale-pending sweep rather than being left "pending" forever.
 */
export const maxDuration = 60;

/**
 * The wall clock a retry has to fit inside.
 *
 * maxDuration is a SERVERLESS limit. `next dev` has no such ceiling, and a
 * fixed 25s deadline meant the retry was silently skipped on every real
 * evaluation, because a real evaluation takes longer than that to fail in the
 * first place — the recovery existed and never once ran.
 *
 * So: in development there is no budget and the retry always happens. In
 * production it happens only when a second attempt of similar length would
 * still fit, since overrunning maxDuration loses the run entirely, which is
 * the outcome the retry exists to prevent.
 */
const RETRY_BUDGET_MS =
  process.env.NODE_ENV === "production" ? maxDuration * 1000 : Infinity;

/** Would a second attempt, taking about as long as the first, still fit? */
function retryFits(startedAt: number): boolean {
  const elapsed = Date.now() - startedAt;
  return elapsed * 2 < RETRY_BUDGET_MS;
}

/** The JSON Schema sent to the model — computed once, not per request. */
const OUTPUT_FORMAT = zodOutputFormat(evaluationWireSchema);

/**
 * Ask the model for the evaluation, constrained to the schema.
 *
 * If the API rejects the schema itself — the compiled grammar exceeding a size
 * limit that is not published and cannot be measured from here — this asks
 * again with the schema written into the prompt instead. That retry is free:
 * the rejection happens before any tokens are generated. The response is
 * validated with Zod either way, so the fallback gives up a guarantee about
 * generation, not about what gets stored.
 */
async function requestEvaluation(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  prompt: { stable: string; variable: string },
) {
  const effort = getEffort() as "low" | "medium" | "high" | "xhigh" | "max";
  const cache = getCacheControl();

  // Caching is a prefix match, so the breakpoints go at the two stability
  // boundaries: the end of the system prompt, and the end of the rubrics. That
  // covers ~89% of the input, all of it byte-identical between runs. Everything
  // student-specific sits after the second breakpoint and is never cached.
  const system = [
    { type: "text" as const, text: SYSTEM_PROMPT, ...(cache ? { cache_control: cache } : {}) },
  ];
  const content = [
    { type: "text" as const, text: prompt.stable, ...(cache ? { cache_control: cache } : {}) },
    { type: "text" as const, text: prompt.variable },
  ];

  try {
    const message = await client.messages
      .stream({
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system,
        output_config: {
          effort,
          // Constrains generation to the schema's shape. We still validate the
          // response ourselves below rather than trusting it.
          format: OUTPUT_FORMAT,
        },
        messages: [{ role: "user", content }],
      })
      .finalMessage();
    return { message, constrained: true };
  } catch (error) {
    // The SDK parses and schema-checks the response inside finalMessage(), so
    // a malformed one throws from there rather than reaching the caller as
    // content. Hand it back as a failed attempt so the retry can act on it.
    if (isStructuredOutputParseError(error)) {
      return { parseError: (error as Error).message, constrained: true };
    }
    if (!isGrammarTooLargeError(error)) throw error;

    console.warn(
      "Structured output rejected the evaluation schema; retrying with schema instructions in the prompt.",
      error,
    );

    const message = await client.messages
      .stream({
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system,
        output_config: { effort },
        messages: [
          {
            role: "user",
            content: [
              ...content,
              {
                type: "text" as const,
                text: renderSchemaInstructions(OUTPUT_FORMAT.schema),
              },
            ],
          },
        ],
      })
      .finalMessage();
    return { message, constrained: false };
  }
}

export async function POST() {
  // 1. Authenticated users only.
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // 2. Clear out any abandoned run first, so a previously-interrupted
  // evaluation doesn't linger as "pending" once this one replaces it.
  await failStalePendingEvaluations();

  // 3. Rate limit per user id (never per client-supplied value).
  const limit = await evaluationRateLimiter.check(user.id);
  if (!limit.ok) {
    const message =
      limit.reason === "cooldown"
        ? `Please wait ${limit.retryAfterSeconds}s before running another evaluation.`
        : `Hourly evaluation limit reached. Try again in about ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`;
    return NextResponse.json(
      { error: message },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // 4. Load the profile — ownership-scoped by the session, not by any input.
  // `user` already carries countryOfOrigin and is deduplicated per request.
  const profile = await getProfileWithRelations();

  if (profile.targetSchools.length === 0) {
    return NextResponse.json(
      {
        error:
          "Add at least one target school before running an evaluation — the rubric depends on where you're applying.",
      },
      { status: 400 },
    );
  }
  if (profile.resumeItems.length === 0 && profile.testScores.length === 0) {
    return NextResponse.json(
      {
        error:
          "Add some resume items or test scores before running an evaluation — there's nothing to assess yet.",
      },
      { status: 400 },
    );
  }

  const snapshot = buildSnapshot(profile, user.countryOfOrigin ?? null);

  // The previous evaluation is fed back in so scores can't drift between runs
  // and can't fall when the student has only added work. Ownership-scoped, and
  // a malformed or missing previous row simply means no comparison.
  // One load for both: the diff that keeps scores consistent, and the item
  // assessments that can be carried over rather than paid for a second time.
  const { diff, reuse } = await loadPreviousContext(profile.id, snapshot);

  const client = getAnthropicClient();
  const isSample = client === null;

  // 5. Create the pending row up front so a failure is still recorded.
  const evaluation = await prisma.evaluation.create({
    data: {
      profileId: profile.id,
      status: "pending",
      promptVersion: PROMPT_VERSION,
      model: isSample ? null : getModel(),
      isSample,
      inputSnapshotJson: JSON.stringify(snapshot),
    },
  });

  // 6a. No API key: store a clearly-labelled sample so the feature is usable.
  if (isSample) {
    const sample = buildSampleResult(snapshot);
    await prisma.evaluation.update({
      where: { id: evaluation.id },
      data: {
        status: "completed",
        resultJson: JSON.stringify(sample),
        overallScore: sample.overallScore,
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ id: evaluation.id, isSample: true });
  }

  // 6b. Real evaluation.
  const startedAt = Date.now();
  try {
    const prompt = buildUserPromptParts(snapshot, diff, reuse);

    // A correction is appended AFTER the variable part, so the cached prefix
    // is identical on the retry and the second attempt reads the cache rather
    // than writing a new entry.
    const attempt = async (extra = ""): Promise<ModelAttempt> => {
      const outcome = await requestEvaluation(client, {
        stable: prompt.stable,
        variable: extra ? `${prompt.variable}\n\n${extra}` : prompt.variable,
      });
      if ("parseError" in outcome) {
        return {
          text: "",
          constrained: outcome.constrained,
          stopReason: null,
          parseError: outcome.parseError,
        };
      }
      const { message, constrained } = outcome;
      // Neither of these is a bad roll of the dice, so neither is retried: a
      // refusal is a decision, and a response that ran out of tokens will
      // simply run out again.
      if (message.stop_reason === "refusal") {
        throw new Error(
          "The model declined to produce an evaluation for this profile.",
        );
      }
      if (message.stop_reason === "max_tokens") {
        throw new Error(
          `The evaluation ran out of room before it finished (max_tokens ${MAX_TOKENS}). Try again, or reduce the size of your profile.`,
        );
      }
      return {
        text: message.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join(""),
        constrained,
        stopReason: message.stop_reason,
        // Present on the constrained path, where the SDK has already parsed
        // and validated it; undefined on the prompt-only path, which falls
        // back to reading the text.
        parsed: message.parsed_output ?? undefined,
      };
    };

    let outcome = parseModelJson(
      evaluationWireSchema,
      await attempt(),
      "model's response",
    );

    // One retry, told what was wrong with the last answer. Generation is
    // stochastic — a single malformed response is usually not repeated — and
    // losing an entire evaluation to one bad roll is a much worse outcome than
    // one extra request.
    if (!outcome.ok && retryFits(startedAt)) {
      console.warn("Evaluation response unusable; retrying once:", outcome.reason);
      const retried = parseModelJson(
        evaluationWireSchema,
        await attempt(renderRetryNote(outcome.reason)),
        "model's response",
      );
      // Report the FIRST failure if both fail: it describes the original
      // problem, where the second describes a response to a correction.
      if (retried.ok) outcome = retried;
      else outcome = { ok: false, reason: `${outcome.reason} Retried once; still unusable.` };
    }

    if (!outcome.ok) throw new Error(outcome.reason);

    // Flattened back into the shape the database, the UI and every previous
    // evaluation use. The wire envelope exists only to keep the grammar small.
    const flattened = fromWireResult(outcome.data);

    // Splice the carried-over assessments back in, in snapshot order. A fresh
    // assessment always wins, so a model that assessed an item anyway is
    // believed over the stored copy.
    const result: EvaluationResult = {
      ...flattened,
      itemAssessments: mergeItemAssessments(
        snapshot,
        flattened.itemAssessments,
        reuse,
      ),
    };
    await prisma.evaluation.update({
      where: { id: evaluation.id },
      data: {
        status: "completed",
        resultJson: JSON.stringify(result),
        overallScore: Math.round(result.overallScore),
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ id: evaluation.id, isSample: false });
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown error.";
    // Record the failure against the evaluation so the user can see what
    // happened in their history rather than losing the attempt silently.
    await prisma.evaluation.update({
      where: { id: evaluation.id },
      data: { status: "failed", error: messageText, completedAt: new Date() },
    });
    console.error("Evaluation failed:", error);
    return NextResponse.json(
      { id: evaluation.id, error: messageText },
      { status: 502 },
    );
  }
}
