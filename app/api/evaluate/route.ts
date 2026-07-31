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
import { getAnthropicClient, getModel, getEffort } from "@/lib/anthropic";
import { buildSnapshot } from "@/lib/evaluation/snapshot";
import { buildSampleResult } from "@/lib/evaluation/sample";
import { buildDiffAgainstPrevious } from "@/lib/evaluation/previous";
import { failStalePendingEvaluations } from "@/lib/evaluation/stale-sweep";
import { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "@/lib/prompts/evaluation";
import type { EvaluationResult } from "@/lib/validation/evaluation";
import {
  evaluationWireSchema,
  fromWireResult,
} from "@/lib/validation/evaluation-wire";
import {
  extractJsonObject,
  isGrammarTooLargeError,
  renderSchemaInstructions,
  responseExcerpt,
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
  prompt: string,
) {
  const effort = getEffort() as "low" | "medium" | "high" | "xhigh" | "max";

  try {
    const message = await client.messages
      .stream({
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        output_config: {
          effort,
          // Constrains generation to the schema's shape. We still validate the
          // response ourselves below rather than trusting it.
          format: OUTPUT_FORMAT,
        },
        messages: [{ role: "user", content: prompt }],
      })
      .finalMessage();
    return { message, constrained: true };
  } catch (error) {
    if (!isGrammarTooLargeError(error)) throw error;

    console.warn(
      "Structured output rejected the evaluation schema; retrying with schema instructions in the prompt.",
      error,
    );

    const message = await client.messages
      .stream({
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        output_config: { effort },
        messages: [
          {
            role: "user",
            content: `${prompt}\n\n${renderSchemaInstructions(OUTPUT_FORMAT.schema)}`,
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
  const diff = await buildDiffAgainstPrevious(profile.id, snapshot);

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
  try {
    const { message, constrained } = await requestEvaluation(
      client,
      buildUserPrompt(snapshot, diff),
    );

    // Which path produced the response. Attached to every failure below: when
    // an evaluation comes back unusable, "was the schema constraint even in
    // force?" is the first question, and without this there is no way to tell
    // a grammar-fallback problem from a model problem.
    const path = constrained ? "constrained" : "prompt-only";

    // The model can decline; check before reading content.
    if (message.stop_reason === "refusal") {
      throw new Error(
        "The model declined to produce an evaluation for this profile.",
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error(
        "The evaluation was cut off before it finished. Try again, or reduce the size of your profile.",
      );
    }

    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");

    if (!text.trim()) {
      throw new Error(
        `The model returned an empty response [${path}, stop_reason: ${message.stop_reason}].`,
      );
    }

    // Handle malformed output gracefully: parse, then validate with Zod, and
    // only store on success. Failures carry an excerpt of what actually came
    // back — it is the only evidence of why, and it is the student's own data
    // on the student's own row.
    const json = extractJsonObject(text);
    let raw: unknown;
    try {
      if (json === null) throw new Error("no JSON object found");
      raw = JSON.parse(json);
    } catch {
      throw new Error(
        `The model returned output that was not valid JSON [${path}, stop_reason: ${message.stop_reason}]. Response began: ${responseExcerpt(text)}`,
      );
    }

    const parsed = evaluationWireSchema.safeParse(raw);
    if (!parsed.success) {
      const shown = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; ");
      throw new Error(
        `The model's response did not match the expected schema [${path}] (${shown}).`,
      );
    }

    // Flattened back into the shape the database, the UI and every previous
    // evaluation use. The wire envelope exists only to keep the grammar small.
    const result: EvaluationResult = fromWireResult(parsed.data);
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
