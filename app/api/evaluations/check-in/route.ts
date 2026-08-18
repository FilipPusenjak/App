// POST /api/evaluations/check-in
//
// Runs the deterministic no-change pass FIRST. If nothing material moved, no
// model is called, no quota is spent, and the student gets a templated standing
// response. That path is the expected one for a quiet fortnight, not a failure.
import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import {
  getAnthropicClient,
  getFollowupEffort,
  getFollowupModel,
} from "@/lib/anthropic";
import type { Effort } from "@/lib/evaluation/model-choice";
import { evaluationRateLimiter } from "@/lib/rate-limit";
import { spendLimitMessage } from "@/lib/spending";
import { getSpendStatus } from "@/lib/spending-account";
import { estimateCost } from "@/lib/cost";
import {
  describeShapeFailure,
  recordTierFailure,
} from "@/lib/evaluation/record-failure";
import { loadForTier, SOURCE_DATA_VERSION } from "@/lib/evaluation/tier-load";
import {
  getUnreadDevelopments,
  markDevelopmentsRead,
} from "@/lib/developments";
import { buildCheckInContext } from "@/lib/evaluation/context/check-in";
import {
  buildNoChangeResponse,
  detectMaterialChange,
} from "@/lib/evaluation/material-change";
import {
  CHECK_IN_PROMPT_VERSION,
  CHECK_IN_SYSTEM_PROMPT,
  buildCheckInUserPrompt,
} from "@/lib/prompts/tiers/check-in-v3";
import { checkInNarrativeSchema, findBannedPhrasing } from "@/lib/validation/tiers";
import { rungMap } from "@/lib/readiness/score";

export const maxDuration = 120;

const OUTPUT_FORMAT = zodOutputFormat(checkInNarrativeSchema);

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const data = await loadForTier("CHECK_IN");

  // Read before the no-change decision, because they change it: a student who
  // reported something and was told nothing changed has been ignored.
  const developments = await getUnreadDevelopments(data.profileId);

  // ── The no-change path, before anything is spent ─────────────────────────
  const verdict = detectMaterialChange({
    scored: data.scored,
    previous: data.preceding
      ? {
          thresholdBand: data.preceding.thresholdBand,
          differentiationBand: data.preceding.differentiationBand,
          paceStatus: data.preceding.paceStatus,
          rungs: data.preceding.rungs,
        }
      : null,
    changeCount: data.changeCount,
    unreadDevelopments: developments.length,
    openCommitments: data.openCommitments,
  });

  if (!verdict.material) {
    // Recorded so the history is complete and the cadence is visible, but with
    // materialChange false, no model, and no cost. Quota is untouched.
    const evaluation = await prisma.evaluation.create({
      data: {
        profileId: data.profileId,
        type: "CHECK_IN",
        status: "completed",
        completedAt: new Date(),
        materialChange: false,
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
        precedingEvaluationId: data.preceding?.id ?? null,
        costCents: 0,
      },
    });

    // Nothing to mark: this path is only reached when there were no unread
    // developments, since one makes the run material by definition.

    return NextResponse.json({
      id: evaluation.id,
      ...buildNoChangeResponse({
        scored: data.scored,
        openCommitments: data.openCommitments,
        nextMilestone: nextMilestone(data.openCommitments),
      }),
    });
  }

  // ── Material change: this one costs money, so the usual gates apply ───────
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
      { error: "No API key configured, so a check-in cannot be produced." },
      { status: 503 },
    );
  }

  const context = buildCheckInContext({
    scored: data.scored,
    changes: verdict.reasons.map((r) => ({ kind: "edited" as const, what: r })),
    openCommitments: data.openCommitments,
    digests: data.digests,
    developments,
    precedingAt: data.preceding?.createdAt ?? null,
  });

  // The cheap model. Never named to the user — the interface says "Check-In",
  // so routing can change without a pricing conversation.
  const model = getFollowupModel() ?? "claude-sonnet-5";

  const message = await client.messages.create({
    model,
    max_tokens: 2000,
    system: CHECK_IN_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildCheckInUserPrompt(context.text) }],
    // Explicit, for the same reason as the deep review. getFollowupEffort
    // defaults to the baseline effort rather than dropping it: a check-in that
    // both changed model AND lowered effort would make an unexplained movement
    // impossible to attribute to either.
    output_config: { format: OUTPUT_FORMAT, effort: getFollowupEffort() as Effort },
  });

  // Read the usage BEFORE anything can reject the output — everything below is
  // a path where the tokens are already spent. See lib/evaluation/record-failure.
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  };
  const failureContext = {
    profileId: data.profileId,
    type: "CHECK_IN" as const,
    model,
    promptVersion: CHECK_IN_PROMPT_VERSION,
    rubricVersion: data.scored.rubricVersion,
    sourceDataVersion: SOURCE_DATA_VERSION,
    precedingEvaluationId: data.preceding?.id ?? null,
    usage,
  };

  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");

  const parsed = checkInNarrativeSchema.safeParse(safeJson(text));
  if (!parsed.success) {
    const id = await recordTierFailure({
      ...failureContext,
      error:
        `The check-in came back in a shape the app could not read, so it was discarded. ` +
        `This run still cost what it used — that cost is recorded here. ` +
        `(Fields the app could not accept: ${describeShapeFailure(parsed.error)}.)`,
      rawOutput: text,
    });
    return NextResponse.json(
      { id, error: "The check-in came back in a shape we could not read." },
      { status: 502 },
    );
  }

  // Last line of defence on the hard constraint. A banned phrasing reaching a
  // student is worse than a failed check-in, so this refuses to store it — but
  // the attempt is still recorded, with what it cost.
  const banned = findBannedPhrasing(parsed.data);
  if (banned.length > 0) {
    const id = await recordTierFailure({
      ...failureContext,
      error: `The check-in was discarded for containing disallowed phrasing (${banned.join(", ")}). This app never states odds of admission. This run still cost what it used — that cost is recorded here.`,
    });
    return NextResponse.json(
      { id, error: "The check-in contained disallowed phrasing and was discarded." },
      { status: 502 },
    );
  }

  const evaluation = await prisma.evaluation.create({
    data: {
      profileId: data.profileId,
      type: "CHECK_IN",
      status: "completed",
      completedAt: new Date(),
      materialChange: true,
      model,
      promptVersion: CHECK_IN_PROMPT_VERSION,
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

  // Only AFTER the row is written. Marking them read first would lose the
  // student's news to any failure between here and there — and the failure
  // paths above are real, as the first live check-in demonstrated.
  await markDevelopmentsRead(
    developments.map((d) => d.id),
    evaluation.id,
  );

  return NextResponse.json({
    id: evaluation.id,
    materialChange: true,
    narrative: parsed.data,
  });
}

function nextMilestone(
  commitments: { description: string; dueDate: Date | null }[],
): { label: string; date: Date } | null {
  const dated = commitments
    .filter((c) => c.dueDate != null)
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
  const next = dated[0];
  return next ? { label: next.description, date: next.dueDate! } : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
