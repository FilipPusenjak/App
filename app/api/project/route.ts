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
  getCacheControl,
} from "@/lib/anthropic";
import { buildProjectionSnapshot } from "@/lib/evaluation/projection-snapshot";
import { buildSampleProjection } from "@/lib/evaluation/projection-sample";
import { buildPreviousProjectionContext } from "@/lib/evaluation/projection-previous";
import { parseStoredResult } from "@/lib/validation/evaluation";
import {
  SYSTEM_PROMPT,
  buildUserPromptParts,
  PROMPT_VERSION,
} from "@/lib/prompts/projection";
import {
  projectionResultSchema,
  type ProjectionResult,
} from "@/lib/validation/projection";
import {
  isGrammarTooLargeError,
  isStructuredOutputParseError,
  parseModelJson,
  renderRetryNote,
  renderSchemaInstructions,
  type ModelAttempt,
} from "@/lib/structured-output";

const MAX_TOKENS = 16000;

/**
 * Same reasoning as the evaluation route, and the same caveat: this is a
 * literal the platform reads from the build output, it is capped by whatever
 * the plan actually allows, and that cap is not observable from here.
 */
export const maxDuration = 300;

/**
 * As in the evaluation route: maxDuration is a serverless limit, so in
 * development there is no budget and the retry always runs. A fixed deadline
 * here meant it never ran at all on a real projection.
 */
/** As in the evaluation route — see the note there on why this is separate. */
function budgetSeconds(): number {
  const configured = Number.parseInt(
    process.env.PROJECTION_TIME_BUDGET_SECONDS ?? "",
    10,
  );
  if (Number.isFinite(configured) && configured > 0) return configured;
  return maxDuration;
}

const RETRY_BUDGET_MS =
  process.env.NODE_ENV === "production" ? budgetSeconds() * 1000 : Infinity;

/** Would a second attempt, taking about as long as the first, still fit? */
function retryFits(startedAt: number): boolean {
  const elapsed = Date.now() - startedAt;
  return elapsed * 2 < RETRY_BUDGET_MS;
}

const OUTPUT_FORMAT = zodOutputFormat(projectionResultSchema);

/**
 * As in the evaluation route: if the API rejects the schema itself because the
 * compiled grammar is too large, ask again with the schema in the prompt. This
 * schema is far smaller than the evaluation's and has never tripped the limit,
 * but the limit is undocumented and the projection schema will keep growing.
 */
async function requestProjection(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  prompt: { stable: string; variable: string },
  lastRunAt: Date | null,
) {
  const effort = getProjectionEffort() as
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";
  // Same rule as the evaluation route: no write unless a read is plausible.
  const cache = getCacheControl(lastRunAt);

  // Same two stability boundaries as the evaluation route.
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
        model: getProjectionModel(),
        max_tokens: MAX_TOKENS,
        system,
        output_config: { effort, format: OUTPUT_FORMAT },
        messages: [{ role: "user", content }],
      })
      .finalMessage();
    return { message, constrained: true };
  } catch (error) {
    // As in the evaluation route: the SDK parses inside finalMessage(), so a
    // malformed response throws from there. Return it as a failed attempt.
    if (isStructuredOutputParseError(error)) {
      return { parseError: (error as Error).message, constrained: true };
    }
    if (!isGrammarTooLargeError(error)) throw error;

    console.warn(
      "Structured output rejected the projection schema; retrying with schema instructions in the prompt.",
      error,
    );

    const message = await client.messages
      .stream({
        model: getProjectionModel(),
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
    profile.countryOfOrigin ?? user.countryOfOrigin ?? null,
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

  // When this profile last ran a projection, for the same cache decision.
  const lastProjection = await prisma.projection.findFirst({
    where: { profileId: profile.id, isSample: false },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const lastProjectionAt = lastProjection?.createdAt ?? null;

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

  const startedAt = Date.now();
  try {
    const prompt = buildUserPromptParts(snapshot, previous);

    const attempt = async (extra = ""): Promise<ModelAttempt> => {
      const outcome = await requestProjection(
        client,
        {
          stable: prompt.stable,
          variable: extra ? `${prompt.variable}\n\n${extra}` : prompt.variable,
        },
        lastProjectionAt,
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
      // Neither a refusal nor a truncated response is a bad roll of the dice,
      // so neither is retried.
      if (message.stop_reason === "refusal") {
        throw new Error(
          "The model declined to produce a projection for these plans.",
        );
      }
      if (message.stop_reason === "max_tokens") {
        throw new Error(
          `The projection ran out of room before it finished (max_tokens ${MAX_TOKENS}). Try again, or shorten your plan list.`,
        );
      }
      return {
        text: message.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join(""),
        constrained,
        stopReason: message.stop_reason,
        // Already parsed and validated by the SDK on the constrained path.
        parsed: message.parsed_output ?? undefined,
      };
    };

    let outcome = parseModelJson(
      projectionResultSchema,
      await attempt(),
      "projection",
    );

    // One retry, told what was wrong — same reasoning as the evaluation route.
    if (!outcome.ok && retryFits(startedAt)) {
      console.warn("Projection response unusable; retrying once:", outcome.reason);
      const retried = parseModelJson(
        projectionResultSchema,
        await attempt(renderRetryNote(outcome.reason)),
        "projection",
      );
      if (retried.ok) outcome = retried;
      else outcome = { ok: false, reason: `${outcome.reason} Retried once; still unusable.` };
    }

    if (!outcome.ok) throw new Error(outcome.reason);

    const result: ProjectionResult = outcome.data;
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
