// POST /api/evaluations/deep-review
//
// Two gates before anything is spent, for two different reasons: entitlement
// (commercial) and the 21-day floor (pedagogical, and enforced even with quota
// remaining). Both are server-side; neither is advisory.
import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getAnthropicClient, getModel } from "@/lib/anthropic";
import { evaluationRateLimiter } from "@/lib/rate-limit";
import { spendLimitMessage } from "@/lib/spending";
import { getSpendStatus } from "@/lib/spending-account";
import { estimateCost } from "@/lib/cost";
import {
  loadCommitmentHistory,
  loadForTier,
  SOURCE_DATA_VERSION,
} from "@/lib/evaluation/tier-load";
import { buildDeepReviewContext } from "@/lib/evaluation/context/deep-review";
import { checkDeepReviewAllowed, tierForUser } from "@/lib/evaluation/tier-access";
import {
  DEEP_REVIEW_PROMPT_VERSION,
  DEEP_REVIEW_SYSTEM_PROMPT,
  buildDeepReviewUserPrompt,
} from "@/lib/prompts/tiers/deep-review-v1";
import {
  deepReviewNarrativeSchema,
  findBannedPhrasing,
} from "@/lib/validation/tiers";
import { rungMap } from "@/lib/readiness/score";

export const maxDuration = 300;

const OUTPUT_FORMAT = zodOutputFormat(deepReviewNarrativeSchema);

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const data = await loadForTier("DEEP_REVIEW");

  // ── Gates, before any spend ──────────────────────────────────────────────
  const gate = checkDeepReviewAllowed({
    tier: tierForUser(user),
    lastDeepReviewAt: data.preceding?.createdAt ?? null,
  });
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: gate.message,
        reason: gate.reason,
        ...(gate.reason === "interval"
          ? {
              nextAllowedAt: gate.nextAllowedAt.toISOString(),
              daysRemaining: gate.daysRemaining,
            }
          : {}),
      },
      { status: gate.reason === "tier" ? 403 : 429 },
    );
  }

  const limit = await evaluationRateLimiter.check(user.id);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many evaluations for now. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const spend = await getSpendStatus();
  if (!spend.allowed) {
    return NextResponse.json({ error: spendLimitMessage(spend) }, { status: 402 });
  }

  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json(
      { error: "No API key configured, so a deep review cannot be produced." },
      { status: 503 },
    );
  }

  // Prior DEEP REVIEWS only — a check-in is not a baseline for a strategy read.
  const priorReviews = await prisma.evaluation.findMany({
    where: {
      profileId: data.profileId,
      type: "DEEP_REVIEW",
      status: "completed",
      isSample: false,
    },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: {
      createdAt: true,
      resultJson: true,
      thresholdSnapshotJson: true,
      differentiationSnapshotJson: true,
      paceStatus: true,
      rubricVersion: true,
    },
  });

  const context = buildDeepReviewContext({
    scored: data.scored,
    // Headlines only. Full prior documents would blow the budget and bias the
    // new review toward repeating itself.
    priorReviews: priorReviews.map((r) => ({
      createdAt: r.createdAt,
      headline: headlineOf(r.resultJson),
      thresholdBand: bandOf(r.thresholdSnapshotJson),
      differentiationBand: bandOf(r.differentiationSnapshotJson),
      paceStatus: r.paceStatus,
      rubricVersion: r.rubricVersion,
    })),
    commitments: await loadCommitmentHistory(data.profileId),
    intendedMajor: data.intendedMajor,
    careerGoal: data.careerGoal,
    schoolContext: data.schoolContext,
  });

  // The strong model. Never named to the user.
  const model = getModel();

  const message = await client.messages.create({
    model,
    max_tokens: 8000,
    system: DEEP_REVIEW_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildDeepReviewUserPrompt(context.text) }],
    output_config: { format: OUTPUT_FORMAT },
  });

  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  const parsed = deepReviewNarrativeSchema.safeParse(safeJson(text));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "The review came back in a shape we could not read." },
      { status: 502 },
    );
  }

  const banned = findBannedPhrasing(parsed.data);
  if (banned.length > 0) {
    return NextResponse.json(
      { error: "The review contained disallowed phrasing and was discarded." },
      { status: 502 },
    );
  }

  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  };

  const evaluation = await prisma.evaluation.create({
    data: {
      profileId: data.profileId,
      type: "DEEP_REVIEW",
      status: "completed",
      completedAt: new Date(),
      model,
      promptVersion: DEEP_REVIEW_PROMPT_VERSION,
      rubricVersion: data.scored.rubricVersion,
      sourceDataVersion: SOURCE_DATA_VERSION,
      paceStatus: data.scored.pace.status,
      thresholdSnapshotJson: JSON.stringify({
        ...data.scored.threshold,
        band: data.scored.thresholdBand,
      }),
      differentiationSnapshotJson: JSON.stringify({
        ...data.scored.differentiation,
        rungs: rungMap(data.scored),
      }),
      resultJson: JSON.stringify(parsed.data),
      precedingEvaluationId: data.preceding?.id ?? null,
      ...usage,
      costCents: Math.round((estimateCost(usage, model) ?? 0) * 100),
    },
  });

  // Proposed, never accepted on the student's behalf. They opt in, and only
  // then does a commitment start appearing in check-ins.
  const now = Date.now();
  await prisma.commitment.createMany({
    data: parsed.data.proposedCommitments.map((c) => ({
      profileId: data.profileId,
      sourceEvaluationId: evaluation.id,
      description: c.description,
      targetRung: c.targetRung,
      dueDate: new Date(now + c.dueInWeeks * 7 * 86_400_000),
      status: "PROPOSED",
    })),
  });

  return NextResponse.json({ id: evaluation.id, narrative: parsed.data });
}

function headlineOf(resultJson: string | null): string {
  const parsed = safeJson(resultJson ?? "") as { sinceLastReview?: unknown } | null;
  const value = parsed?.sinceLastReview;
  return typeof value === "string" ? value.slice(0, 240) : "(no summary stored)";
}

function bandOf(snapshotJson: string | null): string | null {
  const parsed = safeJson(snapshotJson ?? "") as { band?: unknown } | null;
  return typeof parsed?.band === "string" ? parsed.band : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
