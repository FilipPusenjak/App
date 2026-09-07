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
import { authorizeRun, refundFailedRun } from "@/lib/billing/quota-account";
import { costCentsFor } from "@/lib/cost";
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
import {
  RUN_BUDGET_USD,
  MIN_USEFUL_OUTPUT_TOKENS,
  estimateInputTokens,
  maxOutputTokensFor,
  remainingBudget,
} from "@/lib/cost-budget";
import { renderRetryNote } from "@/lib/structured-output";
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

  // The plan's quota. A check-in is the cheap tier but it is still sold as
  // "every two days", and the interval is the promise — see lib/billing/quota.ts.
  // Skipped with no API key: a keyless run is sample output and calls no model,
  // so the quota has no cost to protect. Same reasoning as /api/evaluate.
  const quota =
    getAnthropicClient() === null
      ? null
      : await authorizeRun({ userId: user.id, kind: "CHECK_IN" });
  if (quota && !quota.allowed) {
    return NextResponse.json(
      {
        error: quota.message,
        reason: quota.reason,
        nextAvailableAt: quota.nextAvailableAt?.toISOString() ?? null,
      },
      { status: 402 },
    );
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

  // ── The cost ceiling, sized into the request ──────────────────────────────
  //
  // Same construction as the review's, at a twelfth of the budget: measure the
  // prompt, pay for it, spend what remains on the output allowance. A check-in
  // is the cheap tier and this is where "cheap" stops being a claim about which
  // model it uses and becomes a number it cannot exceed.
  //
  // 2,000 was the old fixed allowance, and at Sonnet's rate that alone is 3
  // cents before a single input token — most of the budget spent on a ceiling
  // nothing was measuring against.
  const userPrompt = buildCheckInUserPrompt(context.text);
  const promptTokens = estimateInputTokens(CHECK_IN_SYSTEM_PROMPT, userPrompt);
  const allowance = maxOutputTokensFor({
    budgetUsd: RUN_BUDGET_USD.CHECK_IN,
    inputTokens: promptTokens,
    model,
    // This route sends NO cache_control — the request below is a plain
    // messages.create with a system string and one user turn. Pricing its input
    // as a cache write would charge it double for something it never does, and
    // at a five cent budget that difference is the whole margin: it put the
    // allowance under the floor and refused check-ins that fit comfortably.
    //
    // Guarded by a test that greps this file for cache_control, because the
    // claim is about code and a future edit could quietly make it false.
    cachesInput: false,
  });

  if (allowance < MIN_USEFUL_OUTPUT_TOKENS.CHECK_IN) {
    // The context has outgrown the budget. Reported rather than half-spent:
    // an allowance too small to finish buys an unparseable answer and still
    // bills for it. buildCheckInContext holds itself to 4,000 tokens, so this
    // fires only if that budget is raised without raising this one.
    return NextResponse.json(
      {
        error: `A check-in for this profile assembles a ${promptTokens.toLocaleString()}-token prompt, which leaves too little of the $${RUN_BUDGET_USD.CHECK_IN.toFixed(2)} per-check-in budget for the answer. Raise CHECK_IN_BUDGET_USD or reduce what the check-in is given.`,
      },
      { status: 507 },
    );
  }

  // Accumulated across attempts rather than assigned, because a retry is a
  // SECOND BILL and reporting only the last one would understate the run.
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };

  // Built at call time rather than up front, because `usage` accumulates across
  // attempts and a snapshot taken before the retry would understate the bill.
  const failureContextFor = (existingId: string) => ({
    profileId: data.profileId,
    type: "CHECK_IN" as const,
    existingId,
    model,
    promptVersion: CHECK_IN_PROMPT_VERSION,
    rubricVersion: data.scored.rubricVersion,
    sourceDataVersion: SOURCE_DATA_VERSION,
    precedingEvaluationId: data.preceding?.id ?? null,
    usage,
  });

  const attempt = async (extra = "", max = allowance): Promise<string> => {
    const message = await client.messages.create({
      model,
      max_tokens: max,
      system: CHECK_IN_SYSTEM_PROMPT,
      // A correction is appended AFTER the prompt, so the first attempt's
      // wording is untouched and the model is answering the same question
      // with one more instruction rather than a different question.
      messages: [
        { role: "user", content: extra ? `${userPrompt}\n\n${extra}` : userPrompt },
      ],
      // Explicit, for the same reason as the deep review. getFollowupEffort
      // defaults to the baseline effort rather than dropping it: a check-in that
      // both changed model AND lowered effort would make an unexplained movement
      // impossible to attribute to either.
      output_config: { format: OUTPUT_FORMAT, effort: getFollowupEffort() as Effort },
    });
    // Read the usage BEFORE anything can reject the output — every path below
    // is one where the tokens are already spent.
    usage.inputTokens += message.usage.input_tokens ?? 0;
    usage.outputTokens += message.usage.output_tokens ?? 0;
    usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
    usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
    return message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
  };

  // ── The row, opened BEFORE the model is called ────────────────────────────
  //
  // This route used to write its row only at the end, on the reasoning that a
  // check-in either produces a narrative or produces nothing. Two things make
  // that wrong.
  //
  // The visible one: nothing outside this request knew a check-in was running.
  // A student who started one and reloaded, or opened the app on their phone,
  // saw no sign of it — the "still running" strip reads pending rows, and a
  // Deep Review and a projection both had one where this did not.
  //
  // The one that costs money: authorizeRun has already spent the credit by
  // now. If the model call throws, there was no row to record the failure
  // against and therefore nothing for refundFailedRun to give back, so the
  // student paid for a run that produced nothing and left no trace. Every
  // failure path below now completes THIS row rather than opening a new one.
  const run = await prisma.evaluation.create({
    data: {
      profileId: data.profileId,
      type: "CHECK_IN",
      status: "pending",
      model,
      promptVersion: CHECK_IN_PROMPT_VERSION,
      precedingEvaluationId: data.preceding?.id ?? null,
    },
    select: { id: true },
  });

  let text: string;
  try {
    text = await attempt();
  } catch (error) {
    // An exception, not an unusable answer: no response came back at all, so
    // there is nothing to parse and nothing to retry against a correction.
    const messageText =
      error instanceof Error ? error.message : "Unknown error.";
    await recordTierFailure({
      ...failureContextFor(run.id),
      error: `The check-in could not be completed: ${messageText}`,
    });
    await refundFailedRun({
      userId: user.id,
      kind: "CHECK_IN",
      runId: run.id,
      usingCredit: quota?.usingCredit ?? false,
    });
    console.error("Check-in failed:", error);
    return NextResponse.json(
      { id: run.id, error: "The check-in could not be completed." },
      { status: 502 },
    );
  }

  let parsed = checkInNarrativeSchema.safeParse(safeJson(text));
  let banned = parsed.success ? findBannedPhrasing(parsed.data) : [];

  // ── One retry, told what was wrong with the last answer ───────────────────
  //
  // The Deep Review has had this since it was written, and the reasoning is
  // the same: generation is stochastic, a single malformed response is usually
  // not repeated, and losing a whole run to one bad roll is a much worse
  // outcome than one extra request. The check-in simply never got it — the
  // only check-in that has ever failed in production failed exactly this way,
  // on a shape the app could not read, with no second attempt.
  //
  // BANNED PHRASING IS RETRIED TOO, and that is deliberate. It is the same
  // kind of fault — the model wrote something it was told not to — and a
  // correction naming the phrase is very likely to fix it. What does NOT
  // change is the refusal to store it: if the retry offends as well, nothing
  // is written, exactly as before. Retrying is not softening the constraint.
  //
  // Sized from what the ceiling has left AFTER the first attempt, whose usage
  // is exact rather than estimated, so the pair still cannot exceed the
  // per-check-in budget. Below the floor, there is no room for a second answer
  // worth having and the first failure stands.
  if (!parsed.success || banned.length > 0) {
    const retryAllowance = maxOutputTokensFor({
      budgetUsd: remainingBudget(RUN_BUDGET_USD.CHECK_IN, usage, model),
      inputTokens: promptTokens,
      model,
      cachesInput: false,
    });
    if (retryAllowance >= MIN_USEFUL_OUTPUT_TOKENS.CHECK_IN) {
      const reason = !parsed.success
        ? `Fields the app could not accept: ${describeShapeFailure(parsed.error)}.`
        : `It contained phrasing this app never uses (${banned.join(", ")}). Never state or imply a probability, chance or odds of admission.`;
      console.warn("Check-in response unusable; retrying once:", reason);
      // A throwing retry must not replace a first failure we can still
      // describe. Swallowed to the log for the same reason the adoption below
      // is conditional: the original problem is the one worth reporting.
      let retryText: string | null = null;
      try {
        retryText = await attempt(renderRetryNote(reason), retryAllowance);
      } catch (error) {
        console.error("Check-in retry threw; keeping the first failure:", error);
      }
      const retryParsed = retryText
        ? checkInNarrativeSchema.safeParse(safeJson(retryText))
        : null;
      const retryBanned = retryParsed?.success
        ? findBannedPhrasing(retryParsed.data)
        : [];
      // Only adopted if it is actually usable. A second unusable answer leaves
      // the FIRST failure reported, because that one describes the original
      // problem rather than the model's response to a correction.
      if (retryText && retryParsed?.success && retryBanned.length === 0) {
        text = retryText;
        parsed = retryParsed;
        banned = [];
      }
    }
  }

  if (!parsed.success) {
    const id = await recordTierFailure({
      ...failureContextFor(run.id),
      error:
        `The check-in came back in a shape the app could not read, so it was discarded. ` +
        `This run still cost what it used — that cost is recorded here. ` +
        `(Fields the app could not accept: ${describeShapeFailure(parsed.error)}.)`,
      rawOutput: text,
    });
    // The cost stays recorded on the row; the charge to the student does not.
    // First failure free, second one in a row not — see refundsFailedRun.
    if (id) {
      await refundFailedRun({
        userId: user.id,
        kind: "CHECK_IN",
        runId: id,
        usingCredit: quota?.usingCredit ?? false,
      });
    }
    return NextResponse.json(
      { id, error: "The check-in came back in a shape we could not read." },
      { status: 502 },
    );
  }

  // Last line of defence on the hard constraint. A banned phrasing reaching a
  // student is worse than a failed check-in, so this refuses to store it — but
  // the attempt is still recorded, with what it cost. Reaching here means the
  // retry above either had no room or offended a second time.
  if (banned.length > 0) {
    const id = await recordTierFailure({
      ...failureContextFor(run.id),
      error: `The check-in was discarded for containing disallowed phrasing (${banned.join(", ")}). This app never states odds of admission. This run still cost what it used — that cost is recorded here.`,
    });
    // Our refusal, not the student's doing — so it is not charged to them
    // either, on the same first-failure-free terms as any other failure.
    if (id) {
      await refundFailedRun({
        userId: user.id,
        kind: "CHECK_IN",
        runId: id,
        usingCredit: quota?.usingCredit ?? false,
      });
    }
    return NextResponse.json(
      { id, error: "The check-in contained disallowed phrasing and was discarded." },
      { status: 502 },
    );
  }

  // The pending row opened before the model call, completed in place.
  const evaluation = await prisma.evaluation.update({
    where: { id: run.id },
    data: {
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
      costCents: costCentsFor(usage, model),
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
