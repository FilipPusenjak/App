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
import { failStalePendingEvaluations } from "@/lib/evaluation/stale-sweep";
import { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "@/lib/prompts/evaluation";
import {
  evaluationResultSchema,
  type EvaluationResult,
} from "@/lib/validation/evaluation";

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
    const stream = client.messages.stream({
      model: getModel(),
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: getEffort() as "low" | "medium" | "high" | "xhigh" | "max",
        // Constrains generation to the Zod schema's shape. We still validate
        // the response ourselves below rather than trusting it.
        format: zodOutputFormat(evaluationResultSchema),
      },
      messages: [{ role: "user", content: buildUserPrompt(snapshot) }],
    });

    const message = await stream.finalMessage();

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
      throw new Error("The model returned an empty response.");
    }

    // Handle malformed output gracefully: parse, then validate with Zod, and
    // only store on success.
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("The model returned output that was not valid JSON.");
    }

    const parsed = evaluationResultSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(
        `The model's response did not match the expected schema${
          first ? ` (${first.path.join(".") || "root"}: ${first.message})` : ""
        }.`,
      );
    }

    const result: EvaluationResult = parsed.data;
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
