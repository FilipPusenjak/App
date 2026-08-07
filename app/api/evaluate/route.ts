// POST /api/evaluate — the only place the Anthropic API is called.
//
// Server-side only. The browser never sees the API key; it can only ask this
// route to run an evaluation for the currently authenticated user. The profile
// is loaded through the ownership helpers, so there is no way for a client to
// request an evaluation of someone else's data — no id is accepted from the
// request body at all. The one thing the body may carry is `full`, a boolean
// asking for a baseline run on the strong model instead of an anchored
// follow-up — a preference about this account's own evaluation, spent against
// this account's own rate limit.
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
  getFollowupModel,
  getFollowupEffort,
  getCacheControl,
} from "@/lib/anthropic";
import {
  chooseEvaluationModel,
  type Effort,
  type ModelChoice,
} from "@/lib/evaluation/model-choice";
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
 * This has to be a literal — the platform reads it out of the build output, so
 * it cannot come from the environment.
 *
 * 300 rather than 60, because an Opus evaluation of a full profile does not fit
 * in a minute and was being killed mid-stream. It is NOT necessarily what your
 * plan permits: hosts cap this at their own limit, and the cap is not
 * observable from here. That is exactly why the abort budget below is a
 * separate, environment-tunable number — if the real ceiling is lower than
 * this, set EVAL_TIME_BUDGET_SECONDS to it and the run still ends with an
 * explanation instead of being killed.
 */
export const maxDuration = 300;

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
/**
 * The wall clock this route actually believes it has, in seconds.
 *
 * Deliberately NOT just maxDuration. A host silently capping maxDuration at a
 * lower value would leave the app budgeting for time it does not have, and the
 * self-abort — the thing that turns a lost run into an explained one — would
 * never fire. Set EVAL_TIME_BUDGET_SECONDS to the ceiling your plan really
 * enforces and the safety net follows it.
 */
function budgetSeconds(): number {
  const configured = Number.parseInt(
    process.env.EVAL_TIME_BUDGET_SECONDS ?? "",
    10,
  );
  if (Number.isFinite(configured) && configured > 0) return configured;
  return maxDuration;
}

const RETRY_BUDGET_MS =
  process.env.NODE_ENV === "production" ? budgetSeconds() * 1000 : Infinity;

/** Would a second attempt, taking about as long as the first, still fit? */
/**
 * How long the model call itself is allowed, leaving room to record the result.
 *
 * Without this the platform kills the function mid-stream: the tokens are
 * billed, the answer is lost, the row stays "pending", and five minutes later
 * the stale sweep reports something vague about the server no longer waiting.
 * The run fails either way — but aborting ourselves means we know WHY, can say
 * so immediately, and can say what to change.
 *
 * 85% of the budget, so the abort, the database write and the response all fit
 * inside what is left.
 */
const MODEL_DEADLINE_FRACTION = 0.85;

function remainingModelBudgetMs(startedAt: number): number {
  if (!Number.isFinite(RETRY_BUDGET_MS)) return Number.POSITIVE_INFINITY;
  return RETRY_BUDGET_MS * MODEL_DEADLINE_FRACTION - (Date.now() - startedAt);
}

/** True when an error is our own deadline firing rather than an API failure. */
function isDeadlineAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

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
  lastRunAt: Date | null,
  choice: ModelChoice,
  signal: AbortSignal | undefined,
) {
  const { model, effort } = choice;
  // Only writes a cache entry when one plausibly still exists to be read.
  // Writing unconditionally costs 2x on the cached portion, which is a loss on
  // every run for anyone who evaluates occasionally rather than in bursts.
  const cache = getCacheControl(lastRunAt);

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
        model,
        max_tokens: MAX_TOKENS,
        system,
        output_config: {
          effort,
          // Constrains generation to the schema's shape. We still validate the
          // response ourselves below rather than trusting it.
          format: OUTPUT_FORMAT,
        },
        messages: [{ role: "user", content }],
      }, { signal })
      .finalMessage();
    return { message, constrained: true };
  } catch (error) {
    // The SDK parses and schema-checks the response inside finalMessage(), so
    // a malformed one throws from there rather than reaching the caller as
    // content. Hand it back as a failed attempt so the retry can act on it.
    // Our own deadline is not a model failure and must not be retried into.
    if (isDeadlineAbort(error)) throw error;
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
        model,
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
      }, { signal })
      .finalMessage();
    return { message, constrained: false };
  }
}

/**
 * The optional request body. Deliberately tiny: one boolean, no identifiers.
 * Anything unparseable is treated as an ordinary run rather than rejected —
 * a malformed body should not cost someone their evaluation.
 */
async function readForceBaseline(request: Request): Promise<boolean> {
  try {
    const body: unknown = await request.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { full?: unknown }).full === true
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
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

  // The STUDENT's home country, falling back to the account default. An
  // account can hold several students and they do not share one.
  const snapshot = buildSnapshot(
    profile,
    profile.countryOfOrigin ?? user.countryOfOrigin ?? null,
  );

  // The previous evaluation is fed back in so scores can't drift between runs
  // and can't fall when the student has only added work. Ownership-scoped, and
  // a malformed or missing previous row simply means no comparison.
  // One load for both: the diff that keeps scores consistent, and the item
  // assessments that can be carried over rather than paid for a second time.
  const { diff, reuse, lastRunAt, releasedScores } = await loadPreviousContext(
    profile.id,
    snapshot,
  );

  // Which model judges this run. A follow-up with its anchor intact reproduces
  // a calibration the baseline model already set, so it can run cheaper; a
  // first run, or one where a score's anchor has been released, cannot.
  const choice = chooseEvaluationModel({
    hasAnchor: diff !== null,
    releasedScores,
    forceBaseline: await readForceBaseline(request),
    baselineModel: getModel(),
    baselineEffort: getEffort() as Effort,
    followupModel: getFollowupModel(),
    followupEffort: getFollowupEffort() as Effort,
  });

  const client = getAnthropicClient();
  const isSample = client === null;

  // 5. Create the pending row up front so a failure is still recorded.
  const evaluation = await prisma.evaluation.create({
    data: {
      profileId: profile.id,
      status: "pending",
      promptVersion: PROMPT_VERSION,
      model: isSample ? null : choice.model,
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
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
  try {
    const prompt = buildUserPromptParts(snapshot, diff, reuse);

    // A correction is appended AFTER the variable part, so the cached prefix
    // is identical on the retry and the second attempt reads the cache rather
    // than writing a new entry.
    const attempt = async (extra = ""): Promise<ModelAttempt> => {
      const budgetMs = remainingModelBudgetMs(startedAt);
      const outcome = await requestEvaluation(
        client,
        {
          stable: prompt.stable,
          variable: extra ? `${prompt.variable}\n\n${extra}` : prompt.variable,
        },
        lastRunAt,
        choice,
        Number.isFinite(budgetMs)
          ? AbortSignal.timeout(Math.max(budgetMs, 1_000))
          : undefined,
      );
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
      // Accumulated rather than assigned: a retry is a second billed request,
      // and reporting only the last one would understate what the run cost.
      usage.inputTokens += message.usage.input_tokens ?? 0;
      usage.outputTokens += message.usage.output_tokens ?? 0;
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;

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
        ...usage,
      },
    });

    return NextResponse.json({ id: evaluation.id, isSample: false });
  } catch (error) {
    // Our own deadline, not the model's failure. Say what happened and what
    // would change it, rather than reporting an abort nobody can act on.
    const messageText = isDeadlineAbort(error)
      ? `This evaluation needed longer than the ${budgetSeconds()}s this deployment allows, so it was stopped before the platform killed it. Nothing was saved and the profile is unchanged. Either shorten the run (ANTHROPIC_EFFORT=low) or give it longer, if your hosting plan permits more.`
      : error instanceof Error
        ? error.message
        : "Unknown error.";
    // Record the failure against the evaluation so the user can see what
    // happened in their history rather than losing the attempt silently.
    await prisma.evaluation.update({
      where: { id: evaluation.id },
      // A failed run still cost whatever it burned before failing, and that
      // is exactly the spend someone chasing a bill needs to see.
      data: {
        status: "failed",
        error: messageText,
        completedAt: new Date(),
        ...usage,
      },
    });
    console.error("Evaluation failed:", error);
    return NextResponse.json(
      { id: evaluation.id, error: messageText },
      { status: 502 },
    );
  }
}
