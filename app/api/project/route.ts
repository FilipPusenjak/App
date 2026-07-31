// POST /api/project — the "what if I did these things" projection.
//
// Structurally the same as /api/evaluate (auth, per-user rate limit, ownership-
// scoped load, pending row, validate before storing), with two differences:
//
//   1. It runs on a cheaper model. A projection reasons forward from scores an
//      evaluation already established, and it is the run a student repeats most
//      while experimenting, so paying evaluation prices for it is waste.
//   2. It writes to the Projection table, never to Evaluation. A hypothetical
//      must never enter the student's real score history.
import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getProfileWithRelations, getOwnedPlannedItems } from "@/lib/ownership";
import { projectionRateLimiter } from "@/lib/rate-limit";
import {
  getAnthropicClient,
  getProjectionModel,
  getProjectionEffort,
} from "@/lib/anthropic";
import { buildProjectionSnapshot } from "@/lib/evaluation/projection-snapshot";
import { buildSampleProjection } from "@/lib/evaluation/projection-sample";
import { buildPreviousProjectionContext } from "@/lib/evaluation/projection-previous";
import { parseStoredResult } from "@/lib/validation/evaluation";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  PROMPT_VERSION,
} from "@/lib/prompts/projection";
import {
  projectionResultSchema,
  type ProjectionResult,
} from "@/lib/validation/projection";
import {
  extractJsonObject,
  isGrammarTooLargeError,
  renderSchemaInstructions,
} from "@/lib/structured-output";

const MAX_TOKENS = 16000;

/** Same reasoning as the evaluation route: platform defaults are too short. */
export const maxDuration = 60;

const OUTPUT_FORMAT = zodOutputFormat(projectionResultSchema);

/**
 * As in the evaluation route: if the API rejects the schema itself because the
 * compiled grammar is too large, ask again with the schema in the prompt. This
 * schema is far smaller than the evaluation's and has never tripped the limit,
 * but the limit is undocumented and the projection schema will keep growing.
 */
async function requestProjection(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  prompt: string,
) {
  const effort = getProjectionEffort() as
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";

  try {
    return await client.messages
      .stream({
        model: getProjectionModel(),
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        output_config: { effort, format: OUTPUT_FORMAT },
        messages: [{ role: "user", content: prompt }],
      })
      .finalMessage();
  } catch (error) {
    if (!isGrammarTooLargeError(error)) throw error;

    console.warn(
      "Structured output rejected the projection schema; retrying with schema instructions in the prompt.",
      error,
    );

    return await client.messages
      .stream({
        model: getProjectionModel(),
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
  }
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const limit = await projectionRateLimiter.check(user.id);
  if (!limit.ok) {
    const message =
      limit.reason === "cooldown"
        ? `Please wait ${limit.retryAfterSeconds}s before running another projection.`
        : `Hourly projection limit reached. Try again in about ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`;
    return NextResponse.json(
      { error: message },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const [profile, plannedItems] = await Promise.all([
    getProfileWithRelations(),
    getOwnedPlannedItems(),
  ]);

  if (plannedItems.length === 0) {
    return NextResponse.json(
      {
        error:
          "Add at least one thing you're planning to do — there's nothing to project yet.",
      },
      { status: 400 },
    );
  }
  if (profile.targetSchools.length === 0) {
    return NextResponse.json(
      {
        error:
          "Add at least one target school first — what a plan is worth depends on where you're applying.",
      },
      { status: 400 },
    );
  }

  // The most recent real evaluation is the baseline the projection moves from,
  // so "45 -> 58" compares against a measured number rather than a fresh guess.
  const baseEvaluation = await prisma.evaluation.findFirst({
    where: { profileId: profile.id, status: "completed", isSample: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      overallScore: true,
      resultJson: true,
    },
  });

  const baseResult = parseStoredResult(baseEvaluation?.resultJson ?? null);
  const systemReadiness: Record<string, number> = {};
  for (const sys of baseResult?.systemScores ?? []) {
    systemReadiness[sys.rubricId] = Math.round(sys.readinessScore);
  }

  const snapshot = buildProjectionSnapshot(
    profile,
    user.countryOfOrigin ?? null,
    plannedItems,
    {
      evaluationId: baseEvaluation?.id ?? null,
      capturedAt: baseEvaluation?.createdAt.toISOString() ?? null,
      overallScore: baseEvaluation?.overallScore ?? null,
      systemReadiness,
    },
  );

  // The previous projection is fed back in so re-running on the same plans
  // can't produce different numbers — the inconsistency this version fixes.
  const previous = await buildPreviousProjectionContext(profile.id, snapshot);

  const client = getAnthropicClient();
  const isSample = client === null;

  const projection = await prisma.projection.create({
    data: {
      profileId: profile.id,
      status: "pending",
      promptVersion: PROMPT_VERSION,
      model: isSample ? null : getProjectionModel(),
      isSample,
      baseEvaluationId: baseEvaluation?.id ?? null,
      inputSnapshotJson: JSON.stringify(snapshot),
    },
  });

  if (isSample) {
    const sample = buildSampleProjection(snapshot);
    await prisma.projection.update({
      where: { id: projection.id },
      data: {
        status: "completed",
        resultJson: JSON.stringify(sample),
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ id: projection.id, isSample: true });
  }

  try {
    const message = await requestProjection(
      client,
      buildUserPrompt(snapshot, previous),
    );

    if (message.stop_reason === "refusal") {
      throw new Error(
        "The model declined to produce a projection for these plans.",
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error(
        "The projection was cut off before it finished. Try again, or shorten your plan list.",
      );
    }

    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");

    if (!text.trim()) {
      throw new Error("The model returned an empty response.");
    }

    const json = extractJsonObject(text);
    let raw: unknown;
    try {
      if (json === null) throw new Error("no JSON object found");
      raw = JSON.parse(json);
    } catch {
      throw new Error("The model returned output that was not valid JSON.");
    }

    const parsed = projectionResultSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(
        `The model's response did not match the expected schema${
          first ? ` (${first.path.join(".") || "root"}: ${first.message})` : ""
        }.`,
      );
    }

    const result: ProjectionResult = parsed.data;
    await prisma.projection.update({
      where: { id: projection.id },
      data: {
        status: "completed",
        resultJson: JSON.stringify(result),
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ id: projection.id, isSample: false });
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown error.";
    await prisma.projection.update({
      where: { id: projection.id },
      data: { status: "failed", error: messageText, completedAt: new Date() },
    });
    console.error("Projection failed:", error);
    return NextResponse.json(
      { id: projection.id, error: messageText },
      { status: 502 },
    );
  }
}
